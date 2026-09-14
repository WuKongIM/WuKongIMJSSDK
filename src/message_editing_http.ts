import { Buffer } from "buffer";
import WKSDK from "./index";
import { Setting } from "./proto";
import { Channel, Conversation, decodePayload, Message, MessageStatus } from "./model";
import { ContentResponse, decimal, MessageEditingOptions, MessageUpdateError } from "./message_updates";

export interface MessageEditingHTTPResponse {
    status: number;
    body: any;
    /** Forward X-WK-Content-Epoch from the successful upstream response. */
    contentEpoch?: string;
}
/** Authenticated application transport, never an unauthenticated Product HTTP URL. */
export type MessageEditingTransport = (path: string, body: any, signal?: AbortSignal) => Promise<MessageEditingHTTPResponse>;
export interface MessageEditingHTTPOptions extends MessageEditingOptions {
    transport: MessageEditingTransport;
    conversationRoute?: "/conversation/list" | "/conversation/sync";
}

function integer(value: any): number {
    if (typeof value !== "string" && typeof value !== "number") { throw new MessageUpdateError("invalid_response"); }
    if (typeof value === "string") { decimal(value); }
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 0) { throw new MessageUpdateError("invalid_response", "Unsafe integer in response"); }
    return n;
}
function identity(row: any): string {
    const value = row.message_idstr || row.message_id;
    return decimal(typeof value === "number" ? String(integer(value)) : value);
}

/** Decode ordinary history, edit-feed and preview rows with the same model mapping. */
export function messageFromHTTP(row: any, channel?: Channel): Message {
    const message = new Message();
    message.messageID = identity(row);
    message.messageSeq = integer(row.message_seq);
    if (channel && row.channel_id !== undefined && (row.channel_id !== channel.channelID || row.channel_type !== channel.channelType)) {
        throw new MessageUpdateError("invalid_response", "Response belongs to a different channel");
    }
    message.channel = channel || new Channel(row.channel_id, row.channel_type);
    if (!message.channel.channelID || !Number.isInteger(message.channel.channelType)) { throw new MessageUpdateError("invalid_response"); }
    message.contentVersion = decimal(row.version === undefined ? "0" : row.version);
    message.updatedAtMs = row.updated_at_ms === undefined ? undefined : integer(row.updated_at_ms);
    message.timestamp = row.timestamp === undefined ? Math.floor(integer(row.server_timestamp_ms || 0) / 1000) : integer(row.timestamp);
    message.fromUID = row.from_uid || "";
    message.clientMsgNo = row.client_msg_no || "";
    message.status = MessageStatus.Normal;
    message.header.noPersist = row.header?.no_persist === 1;
    message.header.syncOnce = row.header?.sync_once === 1;
    message.header.reddot = row.header?.red_dot === 1;
    message.setting = Setting.fromUint8(row.setting || 0);
    if (typeof row.payload !== "string" || row.payload.length > 1398104 ||
        Buffer.from(row.payload, "base64").toString("base64") !== row.payload) {
        throw new MessageUpdateError("invalid_response", "Invalid Base64 payload");
    }
    message.content = decodePayload(Buffer.from(row.payload, "base64"));
    return message;
}

/** Both conversation endpoints share one preview conversion, including edited versions. */
export function conversationFromHTTP(row: any): Conversation {
    const conversation = new Conversation();
    conversation.channel = new Channel(row.channel_id, row.channel_type);
    conversation.unread = integer(row.unread || 0);
    // Canonical active_at is nanoseconds; SDK timestamps are seconds, not uint64 identities.
    const activated = Number(row.active_at || 0);
    if (!Number.isFinite(activated) || activated < 0) { throw new MessageUpdateError("invalid_response"); }
    conversation.timestamp = row.timestamp === undefined ? Math.floor(activated / 1000000000) : integer(row.timestamp);
    const last = row.last_message || row.recents?.[0];
    if (last) {
        conversation.lastMessage = messageFromHTTP(last, conversation.channel);
        if (row.timestamp === undefined) { conversation.timestamp = Math.max(conversation.timestamp, conversation.lastMessage.timestamp); }
    }
    return conversation;
}

/** Install the standard BFF wire contract in one call; teardown restores old providers. */
export function installMessageEditing(sdk: WKSDK, options: MessageEditingHTTPOptions): () => void {
    if (sdk.messageUpdateManager.enabled) { throw new MessageUpdateError("already_enabled"); }
    const provider = sdk.config.provider;
    const previous = {
        updateMessageCallback: provider.updateMessageCallback,
        syncMessageUpdatesCallback: provider.syncMessageUpdatesCallback,
        syncMessagesCallback: provider.syncMessagesCallback,
        syncConversationsCallback: provider.syncConversationsCallback,
    };
    async function post(path: string, body: any, signal?: AbortSignal): Promise<ContentResponse<any>> {
        const response = await options.transport(path, body, signal);
        if (response.status < 200 || response.status >= 300) {
            throw new MessageUpdateError(response.body?.code || "http_error", response.body?.msg || "Request failed", response.status);
        }
        const epoch = response.contentEpoch || response.body?.content_epoch;
        if (epoch === undefined) { throw new MessageUpdateError("content_epoch_missing"); }
        return { contentEpoch: decimal(epoch), data: response.body };
    }
    provider.updateMessageCallback = async (request, signal) => {
        const response = await post("/message/update", {
            channel_id: request.channel.channelID, channel_type: request.channel.channelType,
            message_id: request.messageID, expected_version: request.expectedVersion,
            expected_content_epoch: request.expectedContentEpoch, request_id: request.requestID, payload: request.payload,
        }, signal);
        const ack = response.data.data;
        return { contentEpoch: response.contentEpoch, data: { messageID: identity(ack),
            messageSeq: integer(ack.message_seq), version: decimal(ack.version), updatedAtMs: integer(ack.updated_at_ms) } };
    };
    provider.syncMessageUpdatesCallback = async (channel, opts) => {
        const response = await post("/channel/messageupdates", { channel_id: channel.channelID,
            channel_type: channel.channelType, update_cursor: opts.updateCursor, limit: opts.limit }, opts.signal);
        const page = response.data;
        if (!Array.isArray(page.updates) || page.updates.length > 200) { throw new MessageUpdateError("invalid_response"); }
        return { contentEpoch: response.contentEpoch, data: { updates: page.updates.map((m: any) => messageFromHTTP(m, channel)),
            nextUpdateCursor: page.next_update_cursor, more: page.more, resetRequired: page.reset_required } };
    };
    provider.syncMessagesCallback = async (channel, opts) => {
        const response = await post("/channel/messagesync", { channel_id: channel.channelID, channel_type: channel.channelType,
            start_message_seq: opts.startMessageSeq, end_message_seq: opts.endMessageSeq, limit: opts.limit, pull_mode: opts.pullMode }, opts.signal);
        if (!Array.isArray(response.data.messages)) { throw new MessageUpdateError("invalid_response"); }
        return { contentEpoch: response.contentEpoch, data: response.data.messages.map((m: any) => messageFromHTTP(m, channel)) };
    };
    provider.syncConversationsCallback = async (filter) => {
        const path = options.conversationRoute || "/conversation/sync";
        const defaults = path === "/conversation/sync" ? { version: 0, msg_count: 1, page: 1, page_size: 100 } : { limit: 100 };
        const response = await post(path, Object.assign(defaults, filter));
        const rows = path === "/conversation/sync" ? response.data : response.data.conversations;
        if (!Array.isArray(rows)) { throw new MessageUpdateError("invalid_response"); }
        return { contentEpoch: response.contentEpoch, data: rows.map(conversationFromHTTP),
            removedChannels: (response.data.deletes || []).map((c: any) => new Channel(c.channel_id, c.channel_type)) };
    };
    let disable: () => void;
    try { disable = sdk.messageUpdateManager.enable(options); }
    catch (e) { Object.assign(provider, previous); throw e; }
    let installed = true;
    return () => {
        if (!installed) { return; }
        installed = false; disable(); Object.assign(provider, previous);
    };
}
