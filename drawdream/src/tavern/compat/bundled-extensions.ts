export type BundledExtensionCompatibility = {
  id: string
  displayName: string
  repository: string
  releaseTag: string
  revision: string
  archiveFile: string
  archiveBytes: number
  archiveSha256: string
  manifestVersion: string
  js: string
  css: string
  requiredApis: string[]
  drawdreamCapabilities: string[]
  status: 'supported' | 'partial' | 'unsupported'
  loadStatus: 'manifest-loadable' | 'manifest-invalid'
  runtimeStatus: 'runnable' | 'requires-adapter' | 'blocked'
  missingCapabilities: string[]
}

export type BundledExtensionReport = {
  version: 1
  referenceCommit: string
  totals: { extensions: number; manifestLoadable: number; runnable: number; requiresAdapter: number; blocked: number }
  extensions: BundledExtensionCompatibility[]
}

export function buildBundledExtensionReport(
  extensions: readonly BundledExtensionCompatibility[],
  referenceCommit: string,
): BundledExtensionReport {
  return {
    version: 1,
    referenceCommit,
    totals: {
      extensions: extensions.length,
      manifestLoadable: extensions.filter((extension) => extension.loadStatus === 'manifest-loadable').length,
      runnable: extensions.filter((extension) => extension.runtimeStatus === 'runnable').length,
      requiresAdapter: extensions.filter((extension) => extension.runtimeStatus === 'requires-adapter').length,
      blocked: extensions.filter((extension) => extension.runtimeStatus === 'blocked').length,
    },
    extensions: extensions.map((extension) => ({
      ...extension,
      requiredApis: [...extension.requiredApis],
      drawdreamCapabilities: [...extension.drawdreamCapabilities],
      missingCapabilities: [...extension.missingCapabilities],
    })),
  }
}

export function bundledExtensionReportMarkdown(report: BundledExtensionReport): string {
  const lines = [
    '# PureTavern 内置扩展兼容报告',
    '',
    `参考 commit：\`${report.referenceCommit}\``,
    '',
    `扩展数：${report.totals.extensions}；manifest 可加载：${report.totals.manifestLoadable}；可直接运行：${report.totals.runnable}；需要适配：${report.totals.requiresAdapter}；阻断：${report.totals.blocked}`,
    '',
    '| Extension | Manifest | Runtime | Status | Required APIs | Missing capabilities |',
    '| --- | --- | --- | --- | --- | --- |',
  ]
  for (const extension of report.extensions) {
    lines.push(`| \`${extension.id}\` | ${extension.loadStatus} | ${extension.runtimeStatus} | ${extension.status} | ${extension.requiredApis.join(', ')} | ${extension.missingCapabilities.join(', ') || '-'} |`)
  }
  lines.push('', '结论：manifest 可加载代表归档和入口可识别，runtime 可运行还需要所有声明 API 映射到 DrawDream capability。')
  return `${lines.join('\n')}\n`
}
