import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { openapiSpec } from '../src/openapi/spec'

const outputPath = resolve(process.cwd(), 'openapi.json')
writeFileSync(outputPath, JSON.stringify(openapiSpec, null, 2))
console.log(`OpenAPI spec saved to ${outputPath}`)
