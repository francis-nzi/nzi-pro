const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname,"../src/lib/data-output-csv.ts"),"utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const context = {exports:{}};
vm.runInNewContext(code,context);
const {csvCell,dataOutputFilename,exportContextRows} = context.exports;
const job = {job_number:"J000663",client_name:"EFF Group",reporting_period_start:"2025-04-01",reporting_period_end:"2026-03-31",reporting_year:2026};
test("filename includes job, client, report, period and selected site",()=>{
 assert.equal(dataOutputFilename(job,"Year-on-Year Activity Breakdown Volume","Ware"),"J000663 EFF Group Year-on-Year Activity Breakdown Volume 2025-2026 Ware.csv");
 assert.equal(dataOutputFilename({...job,reporting_period_start:null,reporting_period_end:null},"Data Output Audit"),"J000663 EFF Group Data Output Audit 2026-2026.csv");
});
test("CSV escaping retains commas, quotes, newlines and negative values",()=>{
 assert.equal(csvCell('A, "B"'), '"A, ""B"""');
 assert.equal(csvCell(-12.5),"-12.5"); assert.equal(csvCell("-12.50"),"-12.50");
 assert.equal(csvCell("=1+2"),"'=1+2");
 assert.equal(csvCell("A\rB"),'"A\rB"');
});
test("export includes selected site and job context",()=>{
 const rows=exportContextRows(job,"Ware");
 assert.equal(rows.find(r=>r[0]==="Site Name")[1],"Ware");
 assert.equal(rows.find(r=>r[0]==="Job Number")[1],"J000663");
});
