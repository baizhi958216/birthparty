import { createWebHistory , createRouter } from 'vue-router'
import Party from '../components/Party.vue'
const routes = [
  {
    path: '/:name?', // 动态参数 `name`（可选）
    component: Party,
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router