const FriendButton = {
    props: ['userId'],
    data() {
        return {
            status: 'none',
            loading: false,
            pulsing: false
        }
    },
    methods: {
        async addFriend() {
            this.loading = true;
            //why is this not working
            console.log(this.userId);
            setTimeout(async () => {
                this.status = 'pending';
                this.loading = false;
                this.pulsing = true;
                setTimeout(() => {
                    this.pulsing = false;
                }, 500);
                await this.$root.$graffiti.put({
                    value: { from: this.$root.$graffitiSession.value.actor, status: 'pending' },
                    channels: [`/actors/${this.userId}/friend-requests`]
                }, this.$root.$graffitiSession.value);
                this.$emit('friend-requested', this.userId);
            }, 1000);
        }
    },
    template: `
        <button 
            @click="addFriend"
            :disabled="loading || status !== 'none'"
            class="friend-button"
            :class="{ loading: loading, pulse: pulsing }"
        >
            <span v-if="loading" class="loading-spinner"></span>
            {{ loading ? 'Sending...' : status === 'none' ? 'Add Friend' : 'Request Pending' }}
        </button>
    `
};

const { createApp, nextTick } = await import('vue');
const { GraffitiLocal } = await import('@graffiti-garden/implementation-local');
const { GraffitiPlugin } = await import('@graffiti-garden/wrapper-vue');

createApp({
    components: { FriendButton },
    data() {
        return {
            USER_CHANNEL: 'user-channel',
            searchQuery: '',
            selectedUser: null,
            myMessage: '',
            sending: false,
            creating: false,
            allUsers: [],
            groupChat: { channel: '', name: '' },
            groupChatName: '',
            groupChatMembers: '',
            allNameChanges: [],
            showProfileEditor: false,
            editProfile: { username: '', name: '', pronouns: '', status: '', bio: '' },
            editingMessageUrl: null,
            editMessageContent: '',
            editingGroupChatName: false,
            newGroupChatName: '',
            showInbox: false,
            pendingFriendRequests: [],
            shakeInput: false,
            profileSaved: false,
            newMessageId: null
        }
    },
    computed: {
        filteredUsers() {
            return this.allUsers
                .filter(user => 
                    user.value.username?.toLowerCase().includes(this.searchQuery.toLowerCase())
                )
                .map(user => ({
                    id: user.actor,
                    profile: user.value
                }));
        }
    },
    watch: {
        '$graffitiSession.value': {
            handler(session) {
                if (session) this.ensureProfile(session);
            },
            immediate: true
        }
    },
    methods: {
        sortedMessages(messages) {
            return [...messages].sort((a, b) => a.value.published - b.value.published);
        },
        async sendMessage(session) {
            if (!this.myMessage.trim()) {
                this.shakeInput = true;
                return;
            }
            this.sending = true;
            try {
                // Restrict messages to group members using bto
                const members = this.groupChat.members || [];
                await this.$graffiti.put({
                    value: {
                        content: this.myMessage,
                        published: Date.now(),
                        edited: false,
                        bto: members
                    },
                    channels: [this.groupChat.channel]
                }, session);
                this.myMessage = '';
                this.newMessageId = Math.random().toString(36);
                await nextTick();
                setTimeout(() => {
                    this.newMessageId = null;
                }, 400);
            } finally {
                this.sending = false;
            }
        },

        clearNewMessage(url) {
            if (this.newMessageId === url) {
                this.newMessageId = null;
            }
        },

        startEditMessage(msg) {
            this.editingMessageUrl = msg.url;
            this.editMessageContent = msg.value.content;
        },
         
        cancelEdit() {
            this.editingMessageUrl = null;
            this.editMessageContent = '';
        },

        async saveEditMessage(session, msg) {
            await this.$graffiti.put(
                {
                    ...msg,
                    value: {
                        ...msg.value,
                        content: this.editMessageContent,
                        edited: true,
                    },
                },
                session
            );
            this.cancelEdit();
        },
         
        async deleteMessage(session, url) {
            await this.$graffiti.delete(url, session);
        },

        resolveName(groupChat) {
            if (!groupChat?.channel) return '';
            const changes = this.allNameChanges
                .filter(obj => obj.value.describes === groupChat.channel)
                .sort((a, b) => b.value.published - a.value.published);
            return changes[0]?.value.name || groupChat.name;
        },

        startGroupChatEdit() {
            this.editingGroupChatName = true;
            this.newGroupChatName = this.resolveName(this.groupChat);
        },

        cancelGroupEdit() {
            this.editingGroupChatName = false;
            this.newGroupChatName = '';
        },

        async saveGroupChatName(session) {
            if (!this.newGroupChatName.trim()) return;
            await this.$graffiti.put({
                value: {
                    name: this.newGroupChatName,
                    describes: this.groupChat.channel,
                    published: Date.now()
                },
                channels: [this.groupChat.channel]
            }, session);
            this.cancelGroupEdit();
        },

        async createGroupChat(session) {
            if (!this.groupChatName.trim()) return;
            this.creating = true;
            try {
                const usernames = this.groupChatMembers
                    .split(',')
                    .map(u => u.trim())
                    .filter(u => u.length > 0);

                const members = this.allUsers
                    .filter(u => usernames.includes(u.value.username))
                    .map(u => u.actor);

                if (!members.includes(session.actor)) {
                    members.push(session.actor);
                }

                const groupChannel = crypto.randomUUID();

                for (const member of members) {
                    await this.$graffiti.put({
                        value: {
                            activity: 'Create',
                            object: {
                                type: 'Group Chat',
                                name: this.groupChatName,
                                members,
                                channel: groupChannel
                            }
                        },
                        channels: [`/actors/${member}/group-chats`]
                    }, session);
                }

                this.groupChatName = '';
                this.groupChatMembers = '';
            } finally {
                this.creating = false;
            }
        },

        updateAllUsers(users) {
            this.allUsers = users;
        },

        updatePendingFriendRequests(requests) {
            this.pendingFriendRequests = requests.filter(r => r.value.status === 'pending');
        },
        getUserName(actor) {
            const user = this.allUsers.find(u => u.actor === actor);
            return user ? user.value.username : actor;
        },
        async acceptFriendRequest(req) {
            await this.$graffiti.put({
                ...req,
                value: {
                    ...req.value,
                    status: 'accepted'
                }
            }, this.$graffitiSession.value);
        },
        async declineFriendRequest(req) {
            await this.$graffiti.put({
                ...req,
                value: {
                    ...req.value,
                    status: 'declined'
                }
            }, this.$graffitiSession.value);
        },

        async ensureProfile(session) {
            const existing = this.allUsers.find(u => u.actor === session.actor);
            if (!existing) {
                const defaultUsername = session.actor.split('/').pop() || 'user' + Math.floor(Math.random()*10000);
                const newProfile = await this.$graffiti.put({
                    value: {
                        username: defaultUsername,
                        generator: 'https://kingcabrams.github.io/ChatApp/',
                        name: 'New User',
                        pronouns: '',
                        status: '',
                        bio: ''
                    },
                    channels: [this.USER_CHANNEL]
                }, session);
                this.allUsers.push(newProfile);
            }
        },

        openProfileEditor() {
            const currentProfile = this.allUsers.find(u => u.actor === this.$graffitiSession.value?.actor);
            this.editProfile = currentProfile
                ? { ...currentProfile.value }
                : { username: '', name: '', pronouns: '', status: '', bio: '' };
            this.showProfileEditor = true;
        },

        async saveProfile(session) {
            const currentProfile = this.allUsers.find(u => u.actor === session.actor);
            if (currentProfile) {
                const updatedProfile = { ...currentProfile, value: this.editProfile };
                this.allUsers = this.allUsers.map(u =>
                    u.actor === session.actor ? updatedProfile : u
                );
                await this.$graffiti.put({
                    ...currentProfile,
                    value: this.editProfile,
                    channels: [this.USER_CHANNEL]
                }, session);
            } else {
                await this.$graffiti.put({
                    value: this.editProfile,
                    channels: [this.USER_CHANNEL]
                }, session);
            }
            this.profileSaved = true;
            setTimeout(() => {
                this.showProfileEditor = false;
            }, 1000);
        },

        selectUser(user) {
            this.selectedUser = user;
            this.searchQuery = '';
        },

        handleFriendRequest(userId) {
            this.selectedUser = null;
        }
    }
})
.use(GraffitiPlugin, { graffiti: new GraffitiLocal() })
.mount('#app');
