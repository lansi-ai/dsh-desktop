/**
 * DSH Forge 官方网站 · VitePress 配置
 *
 * 托管：GitHub Pages 项目页 → https://lansi-ai.github.io/dsh-forge/
 * 目录：站点源在 website/，产物在 website/.vitepress/dist（与 Electron 应用的 dist/ 互不干扰）
 * 语言：中文单语（预留 i18n：内容按 guide/ 组织，后续加 en/ 目录即可）
 */
import { defineConfig } from 'vitepress'

/** 站点基路径（项目页形式，仓库名 dsh-forge）。 */
const BASE = '/dsh-forge/'
const REPO = 'https://github.com/lansi-ai/dsh-forge'
const SITE = 'https://lansi-ai.github.io/dsh-forge/'
const DESCRIPTION = 'DSH Forge —— 把桌面操作系统锻造成 DeepSeek Harness 可插拔能力层的桌面客户端'

export default defineConfig({
  lang: 'zh-CN',
  title: 'DSH Forge',
  description: DESCRIPTION,
  base: BASE,
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname: SITE },
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: `${BASE}logo-light.png` }],
    ['meta', { name: 'theme-color', content: '#d97706' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'DSH Forge' }],
    ['meta', { property: 'og:description', content: DESCRIPTION }],
    ['meta', { property: 'og:url', content: SITE }],
  ],
  themeConfig: {
    logo: '/logo-light.png',
    siteTitle: 'DSH Forge',

    nav: [
      { text: '指南', link: '/guide/', activeMatch: '/guide/' },
      { text: '下载', link: '/download' },
      { text: '更新日志', link: `${REPO}/releases` },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '开始使用',
          items: [
            { text: '指南总览', link: '/guide/' },
            { text: '安装与首次启动', link: '/guide/install' },
            { text: '快速上手', link: '/guide/quickstart' },
          ],
        },
        {
          text: '日常使用',
          items: [
            { text: '工作区与会话', link: '/guide/workspace' },
            { text: '桌面能力', link: '/guide/desktop' },
            { text: '设置', link: '/guide/settings' },
            { text: '更新与渠道', link: '/guide/update' },
          ],
        },
        {
          text: '更多',
          items: [
            { text: '常见问题', link: '/guide/faq' },
            { text: '下载安装包', link: '/download' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: REPO }],

    editLink: {
      pattern: `${REPO}/edit/main/website/:path`,
      text: '在 GitHub 上编辑此页',
    },

    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdated: { text: '最后更新于' },

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '没有找到相关结果',
            resetButtonTitle: '清除查询条件',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },

    footer: {
      message: '本项目为独立社区项目，与 DeepSeek 官方无附属关系；相关商标归其各自所有者。',
      copyright: '文档与站点内容按 MIT 发布',
    },

    notFound: {
      title: '页面不存在',
      quote: '这个页面还没有被锻造出来。',
      linkText: '回到首页',
    },
  },
})
