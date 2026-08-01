import type { CompatibilityContract } from './contracts.ts'

export type CompatibilityFixture = {
  id: string
  domain: string
  file: string
}

export type CompatibilityReport = {
  version: 1
  generatedAt: string
  reference: { repository: string; commit: string; license: 'AGPL-3.0' }
  totals: { contracts: number; fixtures: number; coveredContracts: number }
  contracts: Array<CompatibilityContract & { fixtureCount: number; missingFixtureIds: string[] }>
}

export function buildCompatibilityReport(
  contracts: readonly CompatibilityContract[],
  fixtures: readonly CompatibilityFixture[],
  generatedAt = new Date().toISOString(),
): CompatibilityReport {
  const fixtureIds = new Set(fixtures.map((fixture) => fixture.id))
  const reference = contracts.find((contract) => contract.reference)?.reference
  const rows = contracts.map((contract) => {
    const missingFixtureIds = contract.fixtureIds.filter((id) => !fixtureIds.has(id))
    return {
      ...contract,
      fixtureIds: [...contract.fixtureIds],
      ...(contract.reference ? { reference: { ...contract.reference } } : {}),
      fixtureCount: contract.fixtureIds.length - missingFixtureIds.length,
      missingFixtureIds,
    }
  })
  return {
    version: 1,
    generatedAt,
    reference: reference ?? { repository: '', commit: '', license: 'AGPL-3.0' },
    totals: {
      contracts: rows.length,
      fixtures: fixtures.length,
      coveredContracts: rows.filter((row) => row.missingFixtureIds.length === 0).length,
    },
    contracts: rows,
  }
}

export function compatibilityReportMarkdown(report: CompatibilityReport): string {
  const lines = [
    '# PureTavern 兼容矩阵',
    '',
    `生成时间：\`${report.generatedAt}\``,
    `参考仓库：${report.reference.repository} @ \`${report.reference.commit}\``,
    `许可证：\`${report.reference.license}\``,
    '',
    `契约：${report.totals.contracts}；fixture：${report.totals.fixtures}；完整覆盖契约：${report.totals.coveredContracts}`,
    '',
    '| Contract | Status | Fixtures | Missing | Mobile | Reuse | Error behavior |',
    '| --- | --- | ---: | --- | --- | --- | --- |',
  ]
  for (const contract of report.contracts) {
    const errors = contract.status === 'unsupported' ? 'COMPATIBILITY_UNSUPPORTED' : contract.requestSchema ? 'COMPATIBILITY_INVALID_REQUEST' : 'Typed contract response'
    lines.push(`| \`${contract.id}\` | ${contract.status} | ${contract.fixtureCount}/${contract.fixtureIds.length} | ${contract.missingFixtureIds.join(', ') || '-'} | ${contract.mobile} | ${contract.reuse} | ${errors} |`)
  }
  return `${lines.join('\n')}\n`
}
