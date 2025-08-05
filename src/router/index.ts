import { createWebHashHistory , createRouter } from 'vue-router'
import Party from '../components/Party.vue'
const routes = [
  {
    path: '/:name?', // 动态参数 `name`（可选）
    component: Party,
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router