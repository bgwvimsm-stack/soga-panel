<template>
  <footer class="layout-footer">
    Copyright © 2025
    <a
      href="https://github.com/soga-panel/soga-panel"
      target="_blank"
      rel="noopener noreferrer"
    >
      &nbsp;SogaPanel
    </a>
  </footer>
</template>

<style scoped lang="scss">
.layout-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 10px 0 14px;
  font-size: 14px;
  color: rgba(0, 0, 0, 0.6);
  background: linear-gradient(180deg, #f5f7fb 0%, #eef1f6 100%);
  border-top: 1px solid #e5e7eb;

  a {
    color: #409eff;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
}
</style>
