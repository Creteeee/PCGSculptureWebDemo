import { defineConfig } from 'vite';

// GitHub Pages 项目页：base 必须与仓库名一致，否则部署后会因资源路径 404 而白屏。
// 例如：`https://<user>.github.io/PCGSculptureWebDemo/` 对应 base 为 '/PCGSculptureWebDemo/'。
// 若使用 username.github.io 根域部署，将 base 改为 '/'。
export default defineConfig({
	// Vercel 默认根路径部署；GitHub Pages 项目页需要仓库子路径
	base: process.env.VERCEL ? '/' : '/PCGSculptureWebDemo/',
});
