/**
 * Maintainer-only, offline Lindera IPADIC v6.2.0 archive acceptance command.
 * Usage: bun run dict:release:verify /path/to/lindera-ipadic-6.2.0.zip
 *
 * Never downloads, installs, redistributes, or enables the dictionary.
 */
import {
  inspectOfflineIpadicRelease,
  LINDERA_IPADIC_V620_CANDIDATE
} from '../src/core/nlp/ipadic-release-acceptance'

const args = process.argv.slice(2).filter(value => value !== '--')
if (args.length !== 1) {
  console.error('Usage: bun run dict:release:verify /path/to/lindera-ipadic-6.2.0.zip')
  process.exitCode = 2
} else {
  const filePath = args[0]!
  try {
    const file = Bun.file(filePath)
    if (!await file.exists()) {
      console.error(JSON.stringify({ status: 'rejected', reason: 'file-not-found' }))
      process.exitCode = 2
    } else if (file.size !== LINDERA_IPADIC_V620_CANDIDATE.byteLength) {
      // Reject before allocating memory for the file contents.
      console.error(JSON.stringify({ status: 'rejected', reason: 'size-mismatch' }))
      process.exitCode = 1
    } else {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const report = await inspectOfflineIpadicRelease(bytes)
      console.log(JSON.stringify(report, null, 2))
      if (report.status !== 'passed') process.exitCode = 1
    }
  } catch {
    // Avoid logging local file paths and user-supplied dictionary bytes.
    console.error(JSON.stringify({ status: 'rejected', reason: 'read-failed' }))
    process.exitCode = 2
  }
}
