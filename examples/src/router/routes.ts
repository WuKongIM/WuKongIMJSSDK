import { RouteRecordRaw } from 'vue-router';
const chat = () => import('../view/chat.vue')
const login = () => import('../view/Login.vue')
const routes:Array<RouteRecordRaw> = [
    {
        path: '/',
        component: login,
    },
    {
        path: '/chat',
        component: chat,
    },
]
export default routes;

