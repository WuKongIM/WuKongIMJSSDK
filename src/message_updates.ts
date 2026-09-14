import { Buffer } from "buffer";
import WKSDK from "./index";
import { Channel, Conversation, decodePayload, Message, MessageContent, PullMode, SyncOptions } from "./model";
import { ConnectStatus } from "./connect_manager";
import { ConversationAction } from "./conversation_manager";
import { EventPacket } from "./proto";
import { WKEvent } from "./event_manager";
import { Guid } from "./guid";
import { MessageContentType } from "./const";

export interface ContentResponse<T> { contentEpoch: string; data: T; removedChannels?: Channel[]; }
export interface UpdateReadOptions { updateCursor: string; limit: number; signal?: AbortSignal; }
export interface MessageUpdatesPage {
    updates: Message[];
    nextUpdateCursor: string;
    more: boolean;
    resetRequired: boolean;
}
export interface UpdateMessageRequest {
    channel: Channel;
    messageID: string;
    expectedVersion: string;
    expectedContentEpoch: string;
    requestID: string;
    payload: string;
}
export interface UpdateMessageResult { messageID: string; messageSeq: number; version: string; updatedAtMs: number; }
export type MessageUpdateListener = (messages: Message[]) => void;
export interface MessageEditingOptions {
    /** Background failures are reported once after bounded retries. */
    onError?: (error: Error) => void;
    /** Maximum retained history messages. Evicted pages must be fetched again. */
    maxCachedMessages?: number;
    maxCachedBytes?: number;
}

export class MessageUpdateError extends Error {
    constructor(public code: string, message: string = code, public status?: number) {
        super(message);
        Object.setPrototypeOf(this, MessageUpdateError.prototype);
        this.name = "MessageUpdateError";
    }
}

/** Compare canonical uint64 decimal strings without rounding through Number. */
export function decimal(value: string): string {
    if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value) ||
        (value.length === 20 && value > "18446744073709551615")) {
        throw new MessageUpdateError("invalid_response", "Expected a uint64 decimal string");
    }
    return value;
}
export function compareDecimal(a: string, b: string): number {
    decimal(a); decimal(b);
    return a.length === b.length ? (a === b ? 0 : a > b ? 1 : -1) : a.length > b.length ? 1 : -1;
}
function key(channel: Channel, id: string = ""): string {
    return JSON.stringify([channel.channelID, channel.channelType, id]);
}
function retryable(error: any): boolean {
    return error?.name === "TypeError" || error?.code === "network_error" || error?.code === "timeout" || error?.status === 503;
}

interface ActiveChannel {
    channel: Channel;
    controller: AbortController;
    cursor?: string;
    history?: SyncOptions;
    tail: Promise<any>;
    queued: number;
    dirty: boolean;
    running: boolean;
    resetCount: number;
}

/** Owns a single visible-channel feed. No per-user scan or persistent cursor is used. */
export class MessageUpdateManager {
    enabled = false;
    hintsReady = false;
    private options: MessageEditingOptions = {};
    private epoch?: string;
    private account = "";
    private accountGeneration = 0;
    private installation = 0;
    private active?: ActiveChannel;
    private cache = new Map<string, { message: Message; bytes: number }>();
    private cacheBytes = 0;
    private pending = new Map<string, UpdateMessageRequest>();
    private writes = new Set<string>();
    private timer?: ReturnType<typeof setTimeout>;
    private conversationTimer?: ReturnType<typeof setTimeout>;
    private conversationRunning = false;
    private conversationDirty = false;
    private conversationRefreshFull = false;
    private conversationFilter: any;
    private foreground = true;
    private listeners: MessageUpdateListener[] = [];
    private payloadSizes = new WeakMap<MessageContent, number>();
    private suspended = false;
    private changedConversations = new Set<Conversation>();

    constructor(private sdk: WKSDK) {}

    /** Install once after configuring authenticated providers. Returns teardown. */
    enable(options: MessageEditingOptions = {}): () => void {
        if (this.enabled) { throw new MessageUpdateError("already_enabled"); }
        const p = this.sdk.config.provider;
        if (!p.updateMessageCallback || !p.syncMessageUpdatesCallback || !p.syncMessagesCallback || !p.syncConversationsCallback) {
            throw new MessageUpdateError("provider_missing");
        }
        for (const n of [options.maxCachedMessages, options.maxCachedBytes]) {
            if (n !== undefined && (!Number.isSafeInteger(n) || n < 1)) { throw new MessageUpdateError("invalid_options"); }
        }
        this.options = options;
        this.epoch = undefined;
        this.account = "";
        this.enabled = true;
        this.suspended = false;
        this.checkAccount();
        this.sdk.eventManager.addEventListener(this.onEvent);
        this.sdk.connectManager.addConnectStatusListener(this.onConnection);
        if (typeof document !== "undefined") {
            this.foreground = !document.hidden;
            document.addEventListener("visibilitychange", this.onVisibility);
        }
        this.setActive(this.sdk.conversationManager.openConversation?.channel);
        if (this.sdk.connectManager.status === ConnectStatus.Connected) { this.onConnection(ConnectStatus.Connected); }
        const installation = ++this.installation;
        return () => { if (this.installation === installation) { this.disable(); } };
    }

    disable() {
        this.enabled = false;
        this.installation++;
        this.hintsReady = false;
        this.cancelActive();
        if (this.conversationTimer !== undefined) { clearTimeout(this.conversationTimer); }
        this.conversationTimer = undefined;
        this.conversationDirty = false;
        this.conversationRefreshFull = false;
        this.conversationFilter = undefined;
        this.changedConversations.clear();
        this.accountGeneration++;
        this.sdk.eventManager.removeEventListener(this.onEvent);
        this.sdk.connectManager.removeConnectStatusListener(this.onConnection);
        if (typeof document !== "undefined") { document.removeEventListener("visibilitychange", this.onVisibility); }
        this.cache.clear(); this.cacheBytes = 0; this.pending.clear(); this.writes.clear();
    }

    addListener(listener: MessageUpdateListener) { this.listeners.push(listener); }
    removeListener(listener: MessageUpdateListener) { this.listeners = this.listeners.filter((l) => l !== listener); }
    private notify(messages: Message[]) {
        this.changedConversations.forEach((conversation) => {
            try { this.sdk.conversationManager.notifyConversationListeners(conversation, ConversationAction.update); } catch (e) { this.report(e); }
        });
        this.changedConversations.clear();
        if (!messages.length) { return; }
        // User listeners run after the cache/cursor commit and cannot roll it back.
        for (const listener of this.listeners.slice()) {
            try { listener(messages); } catch (e) { this.report(e); }
        }
    }
    private report(error: any) {
        if (error.code === "cancelled") { return; }
        if (this.options.onError) { try { this.options.onError(error); } catch (_) { /* Isolate application callbacks. */ } }
    }

    private checkAccount(): number {
        const account = JSON.stringify([this.sdk.config.uid, this.sdk.config.addr, this.sdk.config.token]);
        if (account !== this.account) {
            const changed = this.account !== "";
            this.account = account;
            this.accountGeneration++;
            this.epoch = undefined;
            this.cancelActive();
            this.cache.clear(); this.cacheBytes = 0; this.pending.clear(); this.writes.clear();
            this.changedConversations.clear();
            if (changed) {
                this.sdk.conversationManager.conversations = [];
                this.sdk.conversationManager.openConversation = undefined;
            }
        }
        return this.accountGeneration;
    }
    private guard(generation: number, state?: ActiveChannel) {
        if (!this.enabled || this.checkAccount() !== generation || (state && (state !== this.active || state.controller.signal.aborted))) {
            throw new MessageUpdateError("cancelled");
        }
    }
    private acceptEpoch(epoch: string) {
        decimal(epoch);
        if (this.epoch !== undefined && compareDecimal(epoch, this.epoch) < 0) { throw new MessageUpdateError("stale_response"); }
        if (this.epoch !== epoch) {
            const previous = this.epoch;
            this.epoch = epoch;
            if (this.active) { this.active.cursor = undefined; }
            if (previous !== undefined) { this.invalidate(); }
        }
    }
    private invalidate(channel?: Channel) {
        const invalid: Message[] = [];
        this.cache.forEach(({ message }) => {
            if (!channel || channel.isEqual(message.channel)) { message.contentStale = true; invalid.push(message); }
        });
        for (const c of this.sdk.conversationManager.conversations) {
            if (c.lastMessage && (!channel || channel.isEqual(c.channel))) { c.lastMessage.contentStale = true; this.changedConversations.add(c); }
        }
        this.cache.forEach((entry, id) => {
            if (!channel || channel.isEqual(entry.message.channel)) { this.cacheBytes -= entry.bytes; this.cache.delete(id); }
        });
        this.notify(invalid);
    }

    setActive(channel?: Channel) {
        if (!this.enabled) { return; }
        this.checkAccount();
        if (channel && this.active?.channel.isEqual(channel)) { return; }
        this.cancelActive();
        if (channel) {
            this.active = { channel: new Channel(channel.channelID, channel.channelType), controller: new AbortController(),
                tail: Promise.resolve(), queued: 0, dirty: false, running: false, resetCount: 0 };
            // The first normal history read establishes the baseline. Never save a head alone.
        }
    }
    private cancelActive() {
        this.active?.controller.abort();
        this.active = undefined;
        if (this.timer !== undefined) { clearTimeout(this.timer); } this.timer = undefined;
    }
    /** Serialize feed pages with history/bootstrap and bound pending application reads. */
    private serial<T>(state: ActiveChannel, run: () => Promise<T>): Promise<T> {
        if (state.queued >= 8) { return Promise.reject(new MessageUpdateError("busy")); }
        state.queued++;
        const result = state.tail.then(run);
        state.tail = result.then(() => undefined, () => undefined).then(() => { state.queued--; });
        return result;
    }

    async syncMessages(channel: Channel, options: SyncOptions): Promise<Message[]> {
        const generation = this.checkAccount();
        const opts = Object.assign(new SyncOptions(), options);
        const state = this.active?.channel.isEqual(channel) ? this.active : undefined;
        const run = async () => {
            this.guard(generation, state);
            if (state) { opts.signal = state.controller.signal; state.history = opts; state.resetCount = 0; }
            let messages: Message[];
            if (state && state.cursor === undefined) { messages = await this.bootstrap(state, generation); }
            else { messages = await this.readHistory(channel, opts, generation, state); }
            if (state) { this.schedule(state); }
            return messages;
        };
        return state ? this.serial(state, run) : run();
    }

    private async readHistory(channel: Channel, opts: SyncOptions, generation: number, state?: ActiveChannel): Promise<Message[]> {
        const result = await this.retry(() => this.sdk.config.provider.syncMessagesCallback!(channel, opts), generation, state);
        this.guard(generation, state);
        if (Array.isArray(result)) { throw new MessageUpdateError("content_epoch_missing"); }
        this.validateMessages(result.data, channel);
        this.acceptEpoch(result.contentEpoch);
        return this.mergePage(result.data, result.contentEpoch, true);
    }

    private async bootstrap(state: ActiveChannel, generation: number, baseline?: ContentResponse<MessageUpdatesPage>): Promise<Message[]> {
        for (let attempt = 0; attempt < 3; attempt++) {
            this.guard(generation, state);
            const head = baseline || await this.fetchUpdates(state, generation, "");
            baseline = undefined;
            if (!head.data.resetRequired || head.data.updates.length) { throw new MessageUpdateError("invalid_response"); }
            this.acceptEpoch(head.contentEpoch);
            const result = await this.retry(() => this.sdk.config.provider.syncMessagesCallback!(state.channel, state.history!), generation, state);
            this.guard(generation, state);
            if (Array.isArray(result)) { throw new MessageUpdateError("content_epoch_missing"); }
            this.validateMessages(result.data, state.channel);
            this.acceptEpoch(result.contentEpoch);
            if (result.contentEpoch !== head.contentEpoch) { continue; }
            const messages = this.mergePage(result.data, result.contentEpoch, true, false);
            state.cursor = head.data.nextUpdateCursor;
            this.notify(messages);
            return messages;
        }
        throw new MessageUpdateError("reset_required");
    }

    private async fetchUpdates(state: ActiveChannel, generation: number, cursor: string) {
        const response = await this.retry(() => this.sdk.config.provider.syncMessageUpdatesCallback!(state.channel,
            { updateCursor: cursor, limit: 100, signal: state.controller.signal }), generation, state);
        this.guard(generation, state);
        const page = response.data;
        decimal(response.contentEpoch);
        if (!page || typeof page.nextUpdateCursor !== "string" || page.nextUpdateCursor.length > 4096 ||
            typeof page.more !== "boolean" || typeof page.resetRequired !== "boolean" || !Array.isArray(page.updates) || page.updates.length > 200) {
            throw new MessageUpdateError("invalid_response");
        }
        this.validateMessages(page.updates, state.channel);
        if (page.more && page.nextUpdateCursor === cursor) { throw new MessageUpdateError("cursor_not_advancing"); }
        return response;
    }

    private schedule(state = this.active) {
        if (!state || !state.history || !this.enabled) { return; }
        state.dirty = true;
        if (this.suspended || !this.foreground || state.running || this.timer !== undefined) { return; }
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.runSync(state).catch((e) => this.report(e));
        }, 100);
    }
    private async runSync(state: ActiveChannel) {
        const generation = this.checkAccount();
        this.guard(generation, state);
        state.running = true;
        try {
            await this.serial(state, async () => {
                this.guard(generation, state);
                state.dirty = false;
                if (state.cursor === undefined) { await this.bootstrap(state, generation); }
                // Yield after a bounded wave; hints received in flight request another wave.
                for (let pageNo = 0; pageNo < 20; pageNo++) {
                    if (this.suspended || !this.foreground) { state.dirty = true; return; }
                    const previousCursor = state.cursor!;
                    const response = await this.fetchUpdates(state, generation, previousCursor);
                    const oldEpoch = this.epoch;
                    this.acceptEpoch(response.contentEpoch);
                    if (response.data.resetRequired || oldEpoch !== response.contentEpoch) {
                        if (++state.resetCount > 3) { state.dirty = false; throw new MessageUpdateError("reset_required"); }
                        this.invalidate(state.channel);
                        state.cursor = undefined;
                        await this.bootstrap(state, generation, response.data.resetRequired ? response : undefined);
                        state.dirty = state.cursor !== "" && state.cursor !== previousCursor;
                        return;
                    }
                    state.resetCount = 0;
                    const messages = this.mergePage(response.data.updates, response.contentEpoch, false, false);
                    state.cursor = response.data.nextUpdateCursor;
                    this.notify(messages);
                    if (!response.data.more) { return; }
                }
                state.dirty = true;
            });
        } finally {
            state.running = false;
            if (this.active === state && state.dirty && this.foreground && !this.suspended) { this.schedule(state); }
        }
    }

    private validateMessages(messages: Message[], channel?: Channel) {
        if (!Array.isArray(messages)) { throw new MessageUpdateError("invalid_response"); }
        for (const m of messages) {
            decimal(m.messageID); decimal(m.contentVersion);
            if (!m.channel || (channel && !channel.isEqual(m.channel)) || !Number.isSafeInteger(m.messageSeq) || m.messageSeq < 0 || !m.content) {
                throw new MessageUpdateError("invalid_response");
            }
            this.payloadSizes.set(m.content, m.content.encode().byteLength);
        }
    }
    private mergePage(messages: Message[], epoch: string, remember: boolean, notify = true): Message[] {
        const merged = messages.map((m) => this.merge(m, epoch, remember)).filter((m): m is Message => !!m);
        if (notify) { this.notify(merged); }
        return merged;
    }
    private merge(incoming: Message, epoch: string, remember: boolean): Message | undefined {
        const id = key(incoming.channel, incoming.messageID);
        const cached = this.cache.get(id)?.message;
        const conversation = this.sdk.conversationManager.findConversation(incoming.channel);
        const preview = conversation?.lastMessage;
        const tail = preview?.messageID === incoming.messageID ? preview : undefined;
        let best = incoming;
        for (const previous of [cached, tail]) {
            if (previous && !previous.contentStale && previous.contentEpoch === epoch && compareDecimal(previous.contentVersion, best.contentVersion) >= 0) { best = previous; }
        }
        if (!remember && !cached && !tail) { return; }
        // Preserve original identity, headers, ordering and app-owned extra fields.
        const result = Object.assign(new Message(), cached || tail || incoming, {
            content: best.content, contentVersion: best.contentVersion, contentEpoch: epoch,
            updatedAtMs: best.updatedAtMs, contentStale: false,
        });
        if (remember || cached) { this.remember(id, result); }
        if (tail && conversation) {
            conversation.lastMessage = result;
            this.changedConversations.add(conversation);
        }
        return result;
    }
    private remember(id: string, message: Message) {
        const bytes = (this.payloadSizes.get(message.content) || message.content.encode().byteLength) + 512;
        const old = this.cache.get(id);
        if (old) { this.cacheBytes -= old.bytes; this.cache.delete(id); }
        this.cache.set(id, { message, bytes }); this.cacheBytes += bytes;
        while (this.cache.size > (this.options.maxCachedMessages || 1000) || this.cacheBytes > (this.options.maxCachedBytes || 8 * 1024 * 1024)) {
            const first = this.cache.keys().next().value;
            this.cacheBytes -= this.cache.get(first)!.bytes;
            this.cache.delete(first);
        }
    }

    /** Original deliveries have no epoch: preserve a known edited copy of the same ID. */
    observeMessage(message: Message): Message {
        if (!this.enabled) { return message; }
        this.checkAccount();
        const cached = this.cache.get(key(message.channel, message.messageID))?.message;
        const tail = this.sdk.conversationManager.findConversation(message.channel)?.lastMessage;
        const previous = cached || (tail?.messageID === message.messageID ? tail : undefined);
        if (previous && previous.contentEpoch === this.epoch && !previous.contentStale) { return previous; }
        if (this.active?.channel.isEqual(message.channel) && message.messageID) { this.remember(key(message.channel, message.messageID), message); }
        return message;
    }

    async syncConversations(filter?: any, previewOnly = false): Promise<Conversation[]> {
        const generation = this.checkAccount();
        this.conversationFilter = filter;
        const result = await this.retry(() => this.sdk.config.provider.syncConversationsCallback(filter), generation);
        this.guard(generation);
        if (Array.isArray(result)) { throw new MessageUpdateError("content_epoch_missing"); }
        this.validateMessages(result.data.filter((c) => c.lastMessage).map((c) => c.lastMessage!));
        this.acceptEpoch(result.contentEpoch);
        const merged = result.data.map((c) => {
            const previous = this.sdk.conversationManager.findConversation(c.channel);
            if (previewOnly) {
                // An edit-triggered read must not import unread/order changes from a
                // separate, concurrent message/read operation into the edit event.
                if (previous?.lastMessage && c.lastMessage?.messageID === previous.lastMessage.messageID) {
                    this.merge(c.lastMessage, result.contentEpoch, false);
                }
                return previous;
            }
            if (c.lastMessage) { c.lastMessage = this.merge(c.lastMessage, result.contentEpoch, true); }
            // A delayed list must not replace a newer tail or its unread/order state.
            if (previous?.lastMessage && (previous.lastMessage.contentEpoch === result.contentEpoch || previous.lastMessage.contentEpoch === undefined) &&
                (!c.lastMessage || previous.lastMessage.messageSeq > c.lastMessage.messageSeq)) { return previous; }
            if (previous) { Object.assign(previous, c); return previous; }
            return c;
        }).filter((c): c is Conversation => !!c);
        for (const c of merged) {
            if (!this.sdk.conversationManager.findConversation(c.channel)) { this.sdk.conversationManager.conversations.push(c); }
            this.changedConversations.add(c);
        }
        this.notify([]);
        for (const channel of result.removedChannels || []) {
            this.sdk.conversationManager.removeConversation(channel);
            this.invalidate(channel);
            if (this.active?.channel.isEqual(channel)) { this.setActive(undefined); }
        }
        return merged;
    }

    async updateMessage(message: Message, content: MessageContent): Promise<Message> {
        const generation = this.checkAccount();
        this.guard(generation);
        if (!message.messageID || message.header.noPersist || message.header.syncOnce || message.isDeleted ||
            message.contentType === MessageContentType.cmd || message.contentType === MessageContentType.stream || message.setting.streamOn ||
            content.contentType === MessageContentType.cmd || content.contentType === MessageContentType.stream) {
            throw new MessageUpdateError("message_not_updatable");
        }
        const bytes = content.encode();
        if (!bytes.length || bytes.length > 1024 * 1024) { throw new MessageUpdateError("invalid_payload"); }
        const payload = Buffer.from(bytes).toString("base64");
        const id = key(message.channel, message.messageID);
        if (this.writes.has(id)) { throw new MessageUpdateError("busy"); }
        this.writes.add(id);
        try {
            let request = this.pending.get(id);
            if (request && request.payload !== payload) { throw new MessageUpdateError("outcome_unknown", "Retry the previous draft before submitting a different edit"); }
            if (!request) {
                if (this.pending.size >= 32) { throw new MessageUpdateError("busy"); }
                if (message.contentEpoch === undefined) {
                    const original = Buffer.from(message.content.encode()).toString("base64");
                    // Up includes the starting sequence; Down interprets the ending bound in reverse.
                    const opts = Object.assign(new SyncOptions(), { startMessageSeq: message.messageSeq,
                        endMessageSeq: message.messageSeq < Number.MAX_SAFE_INTEGER ? message.messageSeq + 1 : 0,
                        pullMode: PullMode.Up, limit: 1 });
                    const page = await this.readHistory(message.channel, opts, generation);
                    const current = page.find((m) => m.messageID === message.messageID);
                    if (!current) { throw new MessageUpdateError("message_not_found"); }
                    if (current.contentVersion !== message.contentVersion || Buffer.from(current.content.encode()).toString("base64") !== original) {
                        throw new MessageUpdateError("version_conflict");
                    }
                    message = current;
                }
                if (message.contentStale || message.contentEpoch !== this.epoch) { throw new MessageUpdateError("content_epoch_conflict"); }
                request = { channel: new Channel(message.channel.channelID, message.channel.channelType), messageID: decimal(message.messageID),
                    expectedVersion: decimal(message.contentVersion), expectedContentEpoch: decimal(message.contentEpoch!),
                    requestID: Guid.create().toString(), payload };
                Object.freeze(request.channel); Object.freeze(request);
                this.pending.set(id, request);
            }
            let response: ContentResponse<UpdateMessageResult>;
            try {
                const fixed = request;
                response = await this.retry(() => this.sdk.config.provider.updateMessageCallback!(fixed), generation);
            } catch (e) {
                if (generation === this.accountGeneration && !retryable(e) && !["invalid_response", "content_epoch_missing", "stale_response"].includes(e.code)) { this.pending.delete(id); }
                throw e;
            }
            this.guard(generation);
            this.acceptEpoch(response.contentEpoch);
            const ack = response.data;
            if (ack.messageID !== request.messageID || ack.messageSeq !== message.messageSeq || compareDecimal(ack.version, request.expectedVersion) <= 0) {
                throw new MessageUpdateError("invalid_response");
            }
            this.pending.delete(id);
            if (response.contentEpoch !== request.expectedContentEpoch) { throw new MessageUpdateError("content_epoch_conflict"); }
            const edited = Object.assign(new Message(), message, { content: decodePayload(Buffer.from(request.payload, "base64")),
                contentVersion: ack.version, updatedAtMs: ack.updatedAtMs });
            const merged = this.mergePage([edited], response.contentEpoch, true)[0];
            this.schedule();
            return merged;
        } finally { if (generation === this.accountGeneration) { this.writes.delete(id); } }
    }

    private async retry<T>(run: () => Promise<T>, generation: number, state?: ActiveChannel): Promise<T> {
        for (let attempt = 0; ; attempt++) {
            this.guard(generation, state);
            try { return await run(); } catch (error) {
                this.guard(generation, state);
                if (attempt >= 2 || !retryable(error)) { throw error; }
                await new Promise<void>((resolve) => setTimeout(resolve, (100 * Math.pow(2, attempt)) * (0.5 + Math.random())));
            }
        }
    }
    /** Suspend proactive work and invalidate in-flight reads on explicit disconnect. */
    connectionClosed() {
        this.hintsReady = false;
        this.suspended = true;
        if (this.active) {
            const old = this.active;
            this.cancelActive();
            this.active = { channel: old.channel, cursor: old.cursor, history: old.history,
                controller: new AbortController(), tail: Promise.resolve(), queued: 0, running: false, dirty: true, resetCount: 0 };
            if (old.history) { this.active.history = Object.assign(new SyncOptions(), old.history, { signal: this.active.controller.signal }); }
        }
    }
    private onConnection = (status: ConnectStatus) => {
        if (!this.enabled) { return; }
        this.checkAccount(); this.hintsReady = false;
        if (status !== ConnectStatus.Connected) { this.connectionClosed(); return; }
        this.suspended = false;
        const packet = new EventPacket();
        packet.type = "message_updates.enable";
        packet.data = Buffer.from('{"enabled":true}', "utf8");
        try { this.sdk.connectManager.sendPacket(packet); }
        catch (_) { this.report(new MessageUpdateError("event_not_supported", "The configured protocol cannot send edit opt-in EVENTs")); }
        this.resume();
    }
    private onEvent = (event: WKEvent) => {
        if (!this.enabled) { return; }
        this.checkAccount();
        if (event.type === "message_updates.ready") { this.hintsReady = event.dataJson?.enabled === true; return; }
        if (!this.hintsReady || event.type !== "message_updated") { return; }
        const data = event.dataJson;
        if (!data || typeof data.channel_id !== "string" || !Number.isInteger(data.channel_type) || typeof data.message_id !== "string") { return; }
        const channel = new Channel(data.channel_id, data.channel_type);
        // Hint versions have no epoch and must never be used as cache versions.
        if (this.active?.channel.isEqual(channel)) { this.schedule(); }
        const conversation = this.sdk.conversationManager.findConversation(channel);
        if (conversation?.lastMessage?.messageID === data.message_id) { this.scheduleConversations(); }
    }
    private onVisibility = () => { this.setForeground(!document.hidden); }
    /** Non-browser hosts can forward their foreground lifecycle here. */
    setForeground(visible: boolean) {
        this.foreground = visible;
        if (visible) { this.resume(); }
        else { if (this.timer !== undefined) { clearTimeout(this.timer); } this.timer = undefined; if (this.conversationTimer !== undefined) { clearTimeout(this.conversationTimer); } this.conversationTimer = undefined; }
    }
    private resume() { this.schedule(); this.scheduleConversations(true); }
    private scheduleConversations(full = false) {
        this.conversationDirty = true;
        this.conversationRefreshFull = this.conversationRefreshFull || full;
        if (this.suspended || !this.foreground || this.conversationRunning || this.conversationTimer !== undefined) { return; }
        this.conversationTimer = setTimeout(async () => {
            this.conversationTimer = undefined;
            if (!this.enabled) { return; }
            this.conversationRunning = true; this.conversationDirty = false;
            const refreshFull = this.conversationRefreshFull;
            this.conversationRefreshFull = false;
            try { await this.syncConversations(this.conversationFilter, !refreshFull); } catch (e) { this.report(e); }
            finally {
                this.conversationRunning = false;
                if (this.enabled && this.conversationDirty) { this.scheduleConversations(); }
            }
        }, 100);
    }
}
