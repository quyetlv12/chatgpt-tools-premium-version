import { expect,test } from 'bun:test'
import { normalizeAccounts,combinedEligible,applyEvent,filteredJobs,journalEligible,usageEligible,runBatch,runCombinedBatch,clearableFailure,failureGroup,matchesFailure } from './twofa-model'
test('normalizes only unambiguous account delimiters and index labels',()=>{
 const p='p?gt-\\*D&\\*'
 expect(normalizeAccounts(`**第1张**\r\na@example.test----${p}----ABCD\n第２张\nb@example.test---- x$& ----EFGH`)).toBe(`a@example.test|${p}|ABCD\nb@example.test| x$& |EFGH`)
 expect(normalizeAccounts('a----p----extra----secret')).toBe('a----p----extra----secret')
 expect(normalizeAccounts('a|p----x|secret')).toBe('a|p----x|secret')
})
test('combined requires verified live check and never re-rotates pending verify',()=>{
 const j={mode:'check_only',status:'success',account_state:'live',login_verified:true}
 expect(combinedEligible(j)).toBe(true)
 expect(combinedEligible({...j,rotated_pending_verify:true})).toBe(false)
 expect(combinedEligible({...j,login_verified:false})).toBe(false)
})
test('passkey bridge stream immediately adds authenticated checklist row',()=>{
 const row={id:'new',email:'synthetic@example.test',status:'success'}
 expect(applyEvent([],{type:'job',job:row})).toEqual([row])
 expect(applyEvent([row],{type:'job',job:{...row,plan:'plus'}})).toEqual([{...row,plan:'plus'}])
 expect(applyEvent([row],{type:'removed',id:'new'})).toEqual([])
})
test('usage filters reject invalid or string percentages',()=>{
 const rows=[{usage:{used_percent:20}},{usage:{used_percent:'10'}},{usage:{used_percent:100}},{usage:{used_percent:-1}}]
 expect(filteredJobs(rows,'usage-low')).toEqual([rows[0]])
 expect(filteredJobs(rows,'usage-full')).toEqual([rows[2]])
})

test('journal accepts verified rotated rows; usage retry only missing Live usage',()=>{
 const j={mode:'change_2fa',status:'success',account_state:'live',login_verified:true}
 expect(journalEligible(j)).toBe(true)
 expect(combinedEligible(j)).toBe(false)
 expect(journalEligible({...j,rotated_pending_verify:true})).toBe(false)
 expect(usageEligible(j)).toBe(true)
 expect(usageEligible({...j,usage:{used_percent:0}})).toBe(false)
 expect(usageEligible({...j,usage_enabled:false})).toBe(false)
 expect(usageEligible({...j,account_state:'dead'})).toBe(false)
})
test('batch continues each account once after rejection and clears attempted selection',async()=>{
 const attempts=[],cleared=[]
 const result=await runBatch([{id:'a'},{id:'b'},{id:'c'}],async row=>{attempts.push(row.id);if(row.id==='b')throw new Error('Rejected')},id=>cleared.push(id))
 expect(attempts).toEqual(['a','b','c'])
 expect(cleared).toEqual(attempts)
 expect(result).toEqual({succeeded:2,failed:1})
})
test('cleanup preserves live error rows while allowing stopped non-live failures',()=>{
 expect(clearableFailure({status:'error',account_state:'live'})).toBe(false)
 expect(clearableFailure({status:'cancelled',account_state:'live'})).toBe(false)
 expect(clearableFailure({status:'error',account_state:'unknown'})).toBe(true)
 expect(clearableFailure({status:'cancelled',account_state:'dead'})).toBe(true)
 expect(clearableFailure({status:'running',account_state:'unknown'})).toBe(false)
})

test('reporting status filters preserve original jobs and action eligibility',()=>{
 const row={mode:'check_only',status:'success',account_state:'live',login_verified:true}
 expect(filteredJobs([row],'error',()=> 'error')).toEqual([row])
 expect(filteredJobs([row],'success',()=> 'error')).toEqual([])
 expect(row.status).toBe('success')
 expect(combinedEligible(row)).toBe(true)
})

test('typed cleanup isolates current DIE and HTTP 403 failures',()=>{
 const base={status:'error',account_state:'unknown'}
 expect(failureGroup({...base,account_state:'die',error:'HTTP 403'})).toBe('die')
 expect(failureGroup({...base,error_kind:'account_die'})).toBe('die')
 expect(failureGroup({...base,error:'MFA verify failed: HTTP 403 - incorrect_code'})).toBe('http403')
 for(const error of ['HTTP 4030','id=403','no mail_provider available',null])expect(failureGroup({...base,error})).toBe('other')
 for(const row of [{...base,account_state:'live',error:'HTTP 403'},{...base,status:'running',account_state:'die'}]) {
   expect(failureGroup(row)).toBe(null)
   expect(matchesFailure(row,'all')).toBe(false)
 }
 expect(matchesFailure({...base,error:'HTTP 403'},'die')).toBe(false)
 expect(matchesFailure({...base,error:'HTTP 403'},'http403')).toBe(true)
 expect(failureGroup({...base,error:null,log_tail:['HTTP 403']})).toBe('other')
})

test('combined batch counts accepted starts only and keeps failed or skipped selections',async()=>{
 const rows=Array.from({length:8},(_,i)=>({id:String(i)})),attempts=[],started=[]
 let active=0,peak=0
 const result=await runCombinedBatch(rows,3,async row=>{
   attempts.push(row.id);active++;peak=Math.max(peak,active)
   await new Promise(resolve=>setTimeout(resolve,1));active--
   if(row.id==='2')throw new Error('Rejected')
   if(row.id==='5')return
   return {id:`op-${row.id}`}
 },id=>started.push(id))
 expect(peak).toBe(3)
 expect(attempts).toEqual(rows.map(row=>row.id))
 expect(started.sort()).toEqual(['0','1','3','4','6','7'])
 expect(result).toEqual({succeeded:6,failed:2})
})
