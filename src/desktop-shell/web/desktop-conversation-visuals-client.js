/**
 * @lansi-ai/dsh-desktop-conversation-visuals —— 对话区视觉层插件（子元素侧 · 不接管槽位）。
 *
 * 职责：为主对话框（官方 ui-conversation 渲染进 center 列的根节点）提供视觉装饰。
 * 当前：主对话框圆角 + 内容裁剪。圆角收敛于对话自身（子元素职责），
 * 而非布局插件（坑 20 边界：只加视觉垫层，不改官方元素定位/缩放）。
 *
 * 约束：
 *  - 不注册 conversation 槽位（与官方 ui-conversation 的单槽位互斥，双注册会抛冲突）；
 *  - 不修改官方代码，只对官方对话根节点（data-phase）做 border-radius/overflow 垫层；
 *  - inject: []（无服务依赖），immediately 启动即可注入样式，后续元素匹配自动生效。
 */
window.__ModuleLoader__.load({
  id: '@lansi-ai/dsh-desktop-conversation-visuals',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports

    /** 注入对话区视觉样式（幂等：先清理旧 style 再写，避免重复标注残留）。 */
    function injectStyles() {
      const css = `
/* 主对话框（官方 ConversationRoot 根节点 <div class="wSkVaW_root" data-phase>）：
   圆角 + 内容裁剪。data-phase 仅对话根节点携带，故用全局 [data-phase]（不依赖
   .dsh-desktop-layout-center 祖先，避免实际 DOM 祖先层级不确定）。
   !important 防官方运行时动态样式表以同特异性覆盖。 */
[data-phase] {
  border-radius: 12px !important;
  overflow: hidden !important;
}
`
      console.log('[dsh-conversation-visuals] injectStyles() called; style appended.')
      document.querySelector('style[data-plugin="@lansi-ai/dsh-desktop-conversation-visuals"]')?.remove()
      const tag = document.createElement('style')
      tag.dataset.plugin = '@lansi-ai/dsh-desktop-conversation-visuals'
      tag.textContent = css
      document.head.appendChild(tag)
    }

    exports.inject = []

    exports.apply = () => {
      injectStyles()
      return () => {
        document.querySelector('style[data-plugin="@lansi-ai/dsh-desktop-conversation-visuals"]')?.remove()
      }
    }

    return module.exports
  },
})
