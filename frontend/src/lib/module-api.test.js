import { afterEach, describe, expect, mock, test } from 'bun:test'
import { modulePath, moduleRequest } from './module-api'
const originalFetch=globalThis.fetch
afterEach(()=>{globalThis.fetch=originalFetch})
describe('module transport',()=>{
  test('restricts modules, traversal and encoded separators',()=>{
    expect(modulePath('twofa','/api/jobs?view=all')).toBe('/modules/twofa/api/jobs?view=all')
    for(const path of ['/../../api/shutdown','/%2e%2e/api/shutdown','/api/%2e./foo','//evil.test','/api%5cfoo'])expect(()=>modulePath('twofa',path)).toThrow()
    expect(()=>modulePath('unknown','/api')).toThrow()
  })
  test('sends exact body and token once without retries',async()=>{
    globalThis.fetch=mock(async()=>new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}}))
    const body={lines:['demo@example.test|p?&*|ABC']}
    expect(await moduleRequest('twofa','/api/jobs',{method:'POST',token:'synthetic',body})).toEqual({ok:true})
    expect(globalThis.fetch.mock.calls).toHaveLength(1)
    expect(globalThis.fetch.mock.calls[0][1].body).toBe(JSON.stringify(body))
    expect(globalThis.fetch.mock.calls[0][1].headers['X-Auth-Token']).toBe('synthetic')
  })
  test('does not echo validation credentials',async()=>{
    globalThis.fetch=mock(async()=>new Response(JSON.stringify({detail:[{input:'sensitive-fixture'}]}),{status:422,headers:{'Content-Type':'application/json'}}))
    expect(moduleRequest('twofa','/api/jobs',{method:'POST'})).rejects.toThrow('HTTP 422')
  })
  test('supports plain output text',async()=>{
    globalThis.fetch=mock(async()=>new Response('synthetic-output',{headers:{'Content-Type':'text/plain'}}))
    expect(await moduleRequest('twofa','/api/output')).toBe('synthetic-output')
  })
})
