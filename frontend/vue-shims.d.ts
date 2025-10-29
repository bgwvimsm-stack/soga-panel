// Vue SFC 类型声明
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

// 模块声明
declare module '@/*'
declare module '~/\*'

// Vite 特定的模块声明
declare module 'virtual:*'
declare module '~icons/*'
declare module '*?inline'
declare module '*?url'
declare module '*?raw'

// 图片模块声明
declare module '*.png'
declare module '*.jpg'
declare module '*.jpeg'
declare module '*.gif'
declare module '*.svg'
declare module '*.ico'
declare module '*.webp'

// CSS 模块声明
declare module '*.css'
declare module '*.scss'
declare module '*.sass'
declare module '*.less'
declare module '*.styl'

// JSON 模块声明
declare module '*.json' {
  const value: any
  export default value
}