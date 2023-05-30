import WKSDK from ".";
import { ConversationAction, ConversationManager } from "./conversation_manager";
import { Channel, Reminder } from "./model";


export class ReminderManager {
    reminders = new Array<Reminder>()
    private static instance: ReminderManager
    public static shared() {
        if (!this.instance) {
            this.instance = new ReminderManager();
        }
        return this.instance;
    }

    private constructor() {
    }

    async sync() {
        if (!WKSDK.shared().config.provider.syncRemindersCallback) {
            console.log("##########syncRemindersCallback##########")
            return
        }
        const version = this.maxReminderVersion()
        const reminders = await WKSDK.shared().config.provider.syncRemindersCallback!(version)
        if (reminders && reminders.length > 0) {
            const channels = new Set<Channel>()
            for (const newReminder of reminders) {
                channels.add(newReminder.channel)
                let exist = false
                for (let index = 0; index < this.reminders.length; index++) {
                    const reminder = this.reminders[index];
                    if (newReminder.reminderID === reminder.reminderID) {
                        this.reminders[index] = newReminder
                        exist = true
                        break
                    }
                }
                if(!exist) {
                    this.reminders.push(newReminder)
                }
            }
            this.updateConversations(Array.from<Channel>(channels))

        }


    }

    async done(ids: number[]) {
        if (!WKSDK.shared().config.provider.reminderDoneCallback) {
            console.log("##########reminderDoneCallback##########")
            return
        }
        const reminders = this.getRemindersWithIDs(ids)
        if (reminders && reminders.length > 0) {
            for (const reminder of reminders) {
                reminder.done = true
            }
            const channels = this.getChannelWithReminders(reminders)
            this.updateConversations(channels)
        }
        return WKSDK.shared().config.provider.reminderDoneCallback!(ids)
    }

    private getChannelWithReminders(reminders: Reminder[]) {
        if (!reminders || reminders.length === 0) {
            return []
        }
        const channels = new Set<Channel>()
        for (const reminder of reminders) {
            channels.add(reminder.channel)
        }
        return Array.from<Channel>(channels)
    }

    updateConversations(channels: Channel[]) {
        const conversations = ConversationManager.shared().findConversations(channels)
        if (conversations && conversations.length > 0) {
            for (const conversation of conversations) {
                conversation.reminders = this.getWaitDoneReminders(conversation.channel)

                ConversationManager.shared().notifyConversationListeners(conversation, ConversationAction.update)
            }
        }
    }

    getWaitDoneReminders(channel: Channel) {
        const channelReminders = new Array<Reminder>()
        for (const reminder of this.reminders) {
            if (reminder.channel.isEqual(channel)) {
                channelReminders.push(reminder)
            }
        }
        return channelReminders
    }

    getRemindersWithIDs(ids: number[]) {
        const newReminders = new Array<Reminder>()
        for (const reminder of this.reminders) {
            for (const id of ids) {
                if (reminder.reminderID === id) {
                    newReminders.push(reminder)
                    break
                }
            }
        }
        return newReminders
    }

    maxReminderVersion() {
        let maxVersion = 0
        for (const reminder of this.reminders) {
            if (reminder.version > maxVersion) {
                maxVersion = reminder.version
            }
        }
        return maxVersion
    }
}