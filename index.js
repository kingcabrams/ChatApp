const FriendButton = {
    props: ['userId'],
    data() {
        return {
            status: 'none',
            loading: false
        }
    },
    methods: {
        async addFriend() {
            this.loading = true;
            setTimeout(async () => {
                this.status = 'pending';
                this.loading = false;
                await this.$root.$graffiti.put({
                    value: {
                        from: this.$root.$graffitiSession.value.actor,
                        status: 'pending'
                    },
                    channels: [this.userId + '/friend-requests']
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
        >
            {{ loading ? 'Sending...' : status === 'none' ? 'Add Friend' : 'Request Pending' }}
        </button>
    `
};

const { createApp } = await import('vue');
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
            channels: ['designftw'],
            editingMessageUrl: null,
            editMessageContent: '',
            editingGroupChatName: false,
            newGroupChatName: '',
            showInbox: false,
            pendingFriendRequests: []
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
            return [...messages].sort((a, b) => b.value.published - a.value.published);
        },

        async sendMessage(session) {
            if (!this.myMessage.trim()) return;
            this.sending = true;
            try {
                await this.$graffiti.put({
                    value: {
                        content: this.myMessage,
                        published: Date.now(),
                        edited: false
                    },
                    channels: [this.groupChat.channel]
                }, session);
                this.myMessage = '';
            } finally {
                this.sending = false;
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
                const members = this.groupChatMembers
                    .split(',')
                    .map(id => id.trim())
                    .filter(id => id.length > 0);

                await this.$graffiti.put({
                    value: {
                        activity: 'Create',
                        object: {
                            type: 'Group Chat',
                            name: this.groupChatName,
                            members,
                            channel: crypto.randomUUID()
                        }
                    },
                    channels: this.channels
                }, session);
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
            if (currentProfile) {
                this.editProfile = { ...currentProfile.value };
            }
            this.showProfileEditor = true;
        },

        async saveProfile(session) {
            const currentProfile = this.allUsers.find(u => u.actor === session.actor);
            if (currentProfile) {
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
            this.showProfileEditor = false;
        },

        selectUser(user) {
            this.selectedUser = user;
            this.searchQuery = '';
        },

        handleFriendRequest(userId) {
            alert(`Friend request sent to ${userId}`);
            this.selectedUser = null;
        }
    }
})
.use(GraffitiPlugin, { graffiti: new GraffitiLocal() })
.mount('#app');