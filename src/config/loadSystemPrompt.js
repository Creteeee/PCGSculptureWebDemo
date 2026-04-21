export async function loadSystemPrompt() {
  const base = import.meta.env.BASE_URL || '/';
  const url = `${base}config/systemPrpmpt.json`;
  const cfgUrl = `${base}config/promptConfig.json`;

  try {
    const [res, cfgRes] = await Promise.all([
      fetch(url, { cache: 'no-cache' }),
      fetch(cfgUrl, { cache: 'no-cache' }),
    ]);
    if (!res.ok) return null;
    const data = await res.json();
    const basePrompt = typeof data?.systemPrompt === 'string' ? data.systemPrompt : null;
    if (!basePrompt) return null;

    // Config is optional; if missing, just return base prompt.
    if (!cfgRes.ok) return basePrompt;
    const cfg = await cfgRes.json().catch(() => null);
    if (!cfg || typeof cfg !== 'object') return basePrompt;

    // Append config as a machine-readable block the model must read first.
    return (
      basePrompt +
      `\n\n====================\nCONFIG（先读再输出）\n====================\n` +
      `你在做任何决策与生成 state_patch/render_request 前，必须先完整阅读并遵守下面的 JSON 配置。\n` +
      `CONFIG_JSON:\n` +
      JSON.stringify(cfg)
    );
  } catch {
    return null;
  }
}

