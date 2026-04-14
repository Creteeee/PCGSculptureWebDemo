# PCGSculptureWebDemo

基于 Three.js + Vite 的程序化雕塑生成预览（GitHub Pages 部署）。

## 本地开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
npm run preview
```

## GitHub Pages 部署（推荐）

本仓库使用 GitHub Actions 自动构建并发布 `dist/` 到 Pages。

- **Pages 设置**：Settings → Pages → Source 选择 **GitHub Actions**
- **Vite base**：`vite.config.js` 中 `base` 需与仓库名一致，例如本仓库是 `/PCGSculptureWebDemo/`

