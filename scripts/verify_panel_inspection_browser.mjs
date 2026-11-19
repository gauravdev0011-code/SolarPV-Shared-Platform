// Browser QA for the isolated localhost Panel Inspection demo.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

const port = Number(process.argv[2] ?? 5248);
assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
const url = `http://127.0.0.1:${port}`;
const debuggingPort = process.argv.includes("--csv-import") ? 9249 : process.argv.includes("--write-only") ? 9248 : 9247;
const output = resolve(".panel-demo", "browser");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "solaris-panel-edge-"));
const browser = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--disable-extensions", "--disable-background-networking", `--user-data-dir=${profile}`,
  "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${debuggingPort}`, "about:blank",
], { windowsHide: true, stdio: "ignore" });
let launchError;
browser.on("error", (error) => { launchError = error; });

async function until(description, condition) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const value = await condition();
    if (value) return value;
    await delay(125);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

let socket;
try {
  const target = await until("Edge control", async () => {
    if (launchError) throw launchError;
    try {
      const endpoints = await fetch(`http://127.0.0.1:${debuggingPort}/json/list`);
      return (await endpoints.json()).find((entry) => entry.type === "page");
    } catch {
      return null;
    }
  });
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (!pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(timer);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`No response to ${method}.`)); }, 12000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  const waitFor = (expression) => until(expression, async () => {
    try {
      return await evaluate(`Boolean(${expression})`);
    } catch (error) {
      if (!/Inspected target navigated|Cannot find context|Execution context was destroyed/.test(error.message)) throw error;
      return false;
    }
  });
  const button = (label) => evaluate(`[...document.querySelectorAll(".pi button")].find(button =>
    (button.getAttribute("aria-label") || button.textContent.trim()) === ${JSON.stringify(label)}).click()`);
  async function screenshot(name, clip) {
    await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`);
    const picture = await send("Page.captureScreenshot", { format: "png", ...(clip && { clip }) });
    await writeFile(join(output, name + ".png"), Buffer.from(picture.data, "base64"));
  }

  async function enter(selector, value) {
    await evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      input.focus();
      input.select();
    })()`);
    await send("Input.insertText", { text: value });
  }
  async function visitField(label, element) {
    return evaluate(`(() => {
      const fields = [...document.querySelectorAll(".pi-capture form ${element}")];
      const position = fields.findIndex(field => field.closest("label")?.firstChild?.textContent === ${JSON.stringify(label)});
      if (position < 0) throw new Error("Missing visit field: " + ${JSON.stringify(label)});
      fields[position].setAttribute("data-qa-field", "active");
      return ".pi-capture form ${element}[data-qa-field=active]";
    })()`);
  }
  async function fillVisit(label, value) {
    const selector = await visitField(label, "input");
    await enter(selector, value);
    await evaluate(`document.querySelector(${JSON.stringify(selector)})?.removeAttribute("data-qa-field")`);
  }
  async function selectOption(selector, value) {
    await evaluate(`(() => {
      const select = document.querySelector(${JSON.stringify(selector)});
      select.value = ${JSON.stringify(value)};
      if (!select.value) throw new Error("Option unavailable: " + ${JSON.stringify(value)});
      select.dispatchEvent(new Event("change", {bubbles:true}));
      select.removeAttribute("data-qa-field");
    })()`);
  }
  async function loadVisitForm() {
    await until("recorded visit form", () => evaluate(`(() => {
      const capture = document.querySelector(".pi-capture");
      const error = capture?.querySelector("[role=alert]");
      if (error) throw new Error(error.textContent);
      if (capture?.querySelector("input[type=file]:enabled")) return true;
      [...capture?.querySelectorAll("button:enabled") ?? []].find(button => button.textContent === "Load recorded visit")?.click();
      return false;
    })()`));
  }
  async function setEvidenceFile(path) {
    const tree = await send("DOM.getDocument");
    const input = await send("DOM.querySelector", {nodeId: tree.root.nodeId, selector: ".pi-capture input[type=file]"});
    await send("DOM.setFileInputFiles", {nodeId: input.nodeId, files: [path]});
  }

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url });
  if (process.argv.includes("--overview-check")) {
    const csv = resolve(process.argv[process.argv.indexOf("--overview-check") + 1]);
    const baseline = process.argv.includes("--before");
    await waitFor(`document.querySelector('.app-sidebar a[href="#panel-inspection"]')`);
    await evaluate(`document.querySelector('.app-sidebar a[href="#panel-inspection"]').click()`);
    await waitFor(`document.querySelectorAll(".pi-module").length === 2540`);
    async function findPanel(id) {
      await enter("#pi-panel-search", id);
      await button("Find panel");
      await waitFor(`document.querySelector(".pi-identity h3")?.textContent === ${JSON.stringify(id)}`);
    }
    async function previewDemo() {
      await button("Import Inspection Data");
      const tree = await send("DOM.getDocument");
      const input = await send("DOM.querySelector", { nodeId: tree.root.nodeId, selector: ".pi-import input[type=file]" });
      await send("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [csv] });
      await button("Preview CSV");
    }
    async function confirmDemo() {
      await waitFor(`document.querySelector(".pi-import input[type=checkbox]")`);
      await evaluate(`document.querySelector(".pi-import input[type=checkbox]").click()`);
      await button("Import inspections");
    }
    await findPanel("J-24-B");
    await previewDemo();
    await confirmDemo();
    if (baseline) {
      await waitFor(`document.querySelector(".pi-import [role=status]")?.textContent.includes("4 visits, 12 readings")`);
      await button("Array Map");
      const overview = await evaluate(`document.querySelector(".pi-detail-body").textContent`);
      assert.match(overview, /Inspection confirmationNot verified/);
      assert.doesNotMatch(overview, /40\.4/);
      await screenshot("panel-overview-before");
      console.log("Reproduced: the exact CSV saved 4 visits and 12 readings, but Overview reported Not verified and omitted the readings.");
    } else {
      await waitFor(`document.querySelector(".pi-import-success")?.textContent.includes("4 visits, 12 readings")`);
      const verifyOverview = () => waitFor(`(() => {
        const detail = document.querySelector(".pi-detail-body")?.textContent ?? "";
        return document.querySelector(".pi-identity h3")?.textContent === "J-24-B" &&
          ["Demo inspection recorded", "Condition not assessed", "2026-11-18", "J-24-B_IMPORT_READY_DEMO_READINGS.csv",
           "40.4 °C", "30.6 °C", "45.2 °C"].every(value => detail.includes(value));
      })()`);
      await verifyOverview();
      await evaluate(`window.scrollTo(0,0)`);
      await screenshot("j24b-overview-imported");
      await button("Inspections");
      await waitFor(`document.querySelector(".pi-detail-body").textContent.includes("Inspection history (4)")`);
      await button("Measurements");
      await waitFor(`document.querySelector(".pi-detail-body").textContent.includes("45.2")`);
      await send("Page.reload");
      await waitFor(`performance.getEntriesByType("navigation")[0]?.type === "reload"`);
      await verifyOverview();
      await previewDemo();
      await confirmDemo();
      await waitFor(`document.querySelector(".pi-import-success")?.textContent.includes("0 new visits or readings")`);
      await button("Inspections");
      await waitFor(`document.querySelector(".pi-detail-body").textContent.includes("Inspection history (4)")`);
      await findPanel("N-56-T");
      await button("Overview");
      await waitFor(`document.querySelector(".pi-detail-body").textContent.includes("No inspections recorded")`);
      await previewDemo();
      await waitFor(`document.querySelector(".pi-import [role=alert]")?.textContent.includes("CSV panel J-24-B does not match selected panel N-56-T")`);
      assert.ok(await evaluate(`!document.querySelector(".pi-import input[type=checkbox]")`));
      await screenshot("n56t-overview-mismatch");
      await button("Array Map");
      await waitFor(`document.querySelector(".pi-detail-body").textContent.includes("No inspections recorded")`);
      const wrongPanel = await evaluate(`fetch("/api/v1/panel-inspection/panels/N-56-T").then(response => response.json()).then(data => data.inspections.length)`);
      assert.equal(wrongPanel, 0);
      await findPanel("J-24-B");
      await waitFor(`[...document.querySelectorAll(".pi-quick-actions button")].some(button => button.textContent === "Upload File")`);
      await button("Upload File");
      await loadVisitForm();
      await selectOption(await visitField("File type", "select"), "csv");
      await setEvidenceFile(csv);
      await waitFor(`document.querySelector(".pi-capture form")?.textContent.includes("J-24-B_IMPORT_READY_DEMO_READINGS.csv")`);
      await fillVisit("Correction reason", "Disposable presentation check");
      await button("Save immutable amendment");
      await waitFor(`document.querySelector(".pi-detail-body [role=status]")?.textContent.includes("Evidence saved") &&
        [...document.querySelectorAll(".pi-detail-body a")].some(link => link.textContent === "J-24-B_IMPORT_READY_DEMO_READINGS.csv")`);
      console.log("Edge passed: exact CSV, 4 visits and 12 readings, latest Overview after reload, zero on retry, N-56-T mismatch, and evidence confirmation.");
    }
  } else if (process.argv.includes("--csv-import")) {
    await waitFor(`document.querySelector('.app-sidebar a[href="#panel-inspection"]')`);
    await evaluate(`document.querySelector('.app-sidebar a[href="#panel-inspection"]').click()`);
    await waitFor(`document.querySelectorAll(".pi-module").length === 2540`);
    await evaluate(`document.querySelector('button[aria-label="Collapse sidebar"]').click()`);
    assert.ok(await evaluate(`Boolean(document.querySelector(".panel-sidebar-collapsed") && document.querySelector('button[aria-label="Expand sidebar"]'))`));
    assert.equal(await evaluate(`getComputedStyle(document.querySelector(".application-main")).marginLeft`), "66px");
    await evaluate(`document.querySelector('button[aria-label="Expand sidebar"]').click()`);
    await evaluate(`document.querySelector("#array-module-J-24-B").dispatchEvent(new MouseEvent("dblclick", {bubbles:true}))`);
    await waitFor(`document.querySelector(".pi-identity h3")?.textContent === "J-24-B" &&
      document.querySelector(".pi-zoom-level")?.textContent === "800%"`);
    await button("Import Inspection Data");
    const header = "panel_id,visit_timestamp,visit_origin,inspection_method,measurement,value,unit,measurement_status,notes\n";
    const timestamp = new Date().toISOString();
    const mismatch = join(output, "j24b-mismatched-panel.csv");
    const invalid = join(output, "j24b-invalid-reading.csv");
    const valid = join(output, "j24b-inspection.csv");
    await writeFile(mismatch, header + `J-24-T,${timestamp},synthetic,Handheld meter,module_temperature,38.1250,degC,measured,\n`);
    await writeFile(invalid, header + `J-24-B,${timestamp},synthetic,Handheld meter,module_temperature,oops,degC,measured,\n`);
    await writeFile(valid, header +
      `J-24-B,${timestamp},synthetic,Handheld meter,module_temperature,38.1250,degC,measured,Stabilized reading\n` +
      `J-24-B,${timestamp},synthetic,Handheld meter,dc_voltage,37.20,V,suspect,Verify calibration\n` +
      `J-24-B,${timestamp},synthetic,Handheld meter,ambient_temperature,,,missing,Sensor unavailable\n`);
    async function chooseCsv(path) {
      const tree = await send("DOM.getDocument");
      const input = await send("DOM.querySelector", { nodeId: tree.root.nodeId, selector: ".pi-import input[type=file]" });
      await send("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [path] });
      await waitFor(`[...document.querySelectorAll(".pi-import button:enabled")].some(button => button.textContent === "Preview CSV")`);
      await button("Preview CSV");
    }
    async function confirmCsv() {
      await evaluate(`document.querySelector(".pi-import input[type=checkbox]").click()`);
      await button("Import inspections");
    }
    const curvePath = process.argv[process.argv.indexOf("--csv-import") + 1];
    if (curvePath) {
      const example = await evaluate(`decodeURIComponent(document.querySelector('a[download="J-24-B-demo-inspection.csv"]').href.split(",")[1])`);
      assert.match(example, /J-24-B,.*synthetic,Demo meter/);
      await chooseCsv(curvePath);
      await waitFor(`document.querySelector(".pi-import [role=alert]")?.textContent.includes("This is an I-V curve CSV")`);
    }
    await chooseCsv(mismatch);
    await waitFor(`document.querySelector(".pi-import [role=alert]")?.textContent.includes("Row 2: CSV panel J-24-T does not match selected panel J-24-B")`);
    assert.ok(await evaluate(`!document.querySelector(".pi-import input[type=checkbox]")`));
    await chooseCsv(valid);
    await waitFor(`document.querySelectorAll(".pi-import tbody tr").length === 3 &&
      document.querySelector(".pi-import table").textContent.includes("Missing")`);
    assert.ok(await evaluate(`[...document.querySelectorAll(".pi-import button")].find(button => button.textContent === "Import inspections").disabled`));
    await screenshot("inspection-csv-preview");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await waitFor(`innerWidth === 390`);
    assert.ok(await evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`));
    await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await confirmCsv();
    await waitFor(`document.querySelector(".pi-import-success")?.textContent.includes("1 visit, 3 readings")`);
    await waitFor(`document.querySelector(".pi-identity h3")?.textContent === "J-24-B" &&
      document.querySelector(".pi-detail-body")?.textContent.includes("38.125")`);
    await button("Measurements");
    await waitFor(`document.querySelector(".pi-detail-body")?.textContent.includes("38.125") &&
      document.querySelector(".pi-detail-body")?.textContent.includes("Sensor unavailable") &&
      document.querySelector(".pi-detail-body")?.textContent.includes("CSV status · suspect") &&
      document.querySelector(".pi-detail-body")?.textContent.includes("37.2 V")`);
    await screenshot("j24b-csv-measurements");
    await button("Inspections");
    await button("Open full visit record");
    await waitFor(`document.querySelector(".pi-detail-body section[aria-label^=Visit]")?.textContent.includes("38.1250")`);
    const before = await evaluate(`document.querySelector(".pi-visit select").options.length`);
    await send("Page.reload");
    await waitFor(`performance.getEntriesByType("navigation")[0]?.type === "reload" && document.querySelector("#pi-panel-search")`);
    await enter("#pi-panel-search", "J-24-B");
    await button("Find panel");
    await button("Measurements");
    await waitFor(`document.querySelector(".pi-detail-body")?.textContent.includes("Sensor unavailable")`);
    await button("Import Inspection Data");
    await chooseCsv(valid);
    await waitFor(`document.querySelector(".pi-import input[type=checkbox]")`);
    await confirmCsv();
    await waitFor(`document.querySelector(".pi-import-success")?.textContent.includes("0 new visits or readings")`);
    await button("Import Inspection Data");
    await chooseCsv(invalid);
    await waitFor(`document.querySelector(".pi-import [role=alert]")?.textContent.includes("Row 2: Use an unambiguous decimal reading")`);
    assert.ok(await evaluate(`!document.querySelector(".pi-import input[type=checkbox]")`));
    await button("Array Map");
    await button("Measurements");
    await waitFor(`document.querySelector(".pi-detail-body")?.textContent.includes("38.125")`);
    assert.equal(await evaluate(`document.querySelector(".pi-visit select").options.length`), before);
    await button("Upload File");
    await loadVisitForm();
    await selectOption(await visitField("File type", "select"), "csv");
    const evidenceName = curvePath ? "J-24-B_iv_curve.csv" : "j24b-inspection.csv";
    await setEvidenceFile(curvePath ?? valid);
    await waitFor(`document.querySelector(".pi-capture form")?.textContent.includes(${JSON.stringify(evidenceName)})`);
    await fillVisit("Correction reason", "Record CSV as evidence");
    await button("Save immutable amendment");
    await waitFor(`[...document.querySelectorAll(".pi-detail-body a")].some(link => link.textContent === ${JSON.stringify(evidenceName)})`);
    await button("Measurements");
    await waitFor(`document.querySelector(".pi-detail-body")?.textContent.includes("CSV status · suspect")`);
    assert.equal(await evaluate(`document.querySelector(".pi-visit select").options.length`), before);
    assert.equal(await evaluate(`document.querySelector(".pi-detail-body table tbody").rows.length`), 3);
    assert.deepEqual(errors, []);
    console.log("Edge passed for J-24-B: selected-panel mismatch, one visit and three readings, original precision, missing value and notes, reload, zero duplicates, unchanged history after an invalid file, and attachment-only evidence upload.");
  } else if (process.argv.includes("--inverters")) {
    await waitFor(`[...document.querySelectorAll(".app-sidebar a")].some(link => link.textContent.trim() === "Inverters")`);
    await evaluate(`[...document.querySelectorAll(".app-sidebar a")].find(link => link.textContent.trim() === "Inverters").click()`);
    await evaluate(`[...document.querySelectorAll("button")].find(item => item.textContent === "Open live workspace")?.click()`);
    await waitFor(`document.querySelectorAll(".inverter-map g[role=button]").length === 8 && document.querySelector(".inverter-page h3")`);
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll(".inverter-map g[role=button]"), node => node.getAttribute("aria-label"))`),
      Array.from({length:8}, (_, index) => "INV.0" + (index + 1)));
    assert.match(await evaluate(`document.querySelector(".inverter-page").textContent`), /8 imported records.*Not configured.*Unverified/);
    await screenshot("inverters-overview");
    await evaluate(`document.querySelector('.inverter-map g[aria-label="INV.04"]').dispatchEvent(new MouseEvent("click",{bubbles:true}))`);
    await waitFor(`document.querySelector(".inverter-page footer").textContent.includes("Proposed INVT-004 · Unverified")`);
    assert.equal(await evaluate(`document.querySelector(".inverter-page h3") === null`), true);
    await screenshot("inverters-unverified-mapping");
    await evaluate(`(() => {
      const select = document.querySelector(".inverter-page select");
      select.value = Array.from(select.options).find(item => item.textContent === "INVT-008").value;
      select.dispatchEvent(new Event("change",{bubbles:true}));
    })()`);
    await button("Communication");
    const communication = await evaluate(`document.querySelector(".inverter-page .pi-facts").textContent`);
    assert.match(communication, /DEV_59.*Comm ID8.*Modbus TCP.*502.*unit unspecified/);
    assert.doesNotMatch(communication, /\d+\.\d+\.\d+\.\d+|Online/);
    await screenshot("inverters-communication");
    await button("History");
    await waitFor(`document.querySelector(".inverter-page").textContent.includes("No inspections recorded.")`);
    await button("Notes");
    await waitFor(`document.querySelector(".inverter-page").textContent.includes("No notes yet.")`);
    assert.deepEqual(errors, []);
    console.log("Edge passed: eight markers, independent unverified selection, eight imported devices, communication redaction, history and Notes.");
  } else {
  await waitFor(`[...document.querySelectorAll(".app-sidebar a")].some(link => link.textContent.trim() === "Panel Inspection")`);
  await evaluate(`[...document.querySelectorAll(".app-sidebar a")].find(link => link.textContent.trim() === "Panel Inspection").click()`);
  await waitFor(`document.querySelectorAll(".pi-module").length === 2540 && document.querySelector(".pi-detail-body dd")`);
  if (!process.argv.includes("--write-only")) {
  await waitFor(`document.querySelector(".pi-stats > div:nth-child(3) strong")?.textContent === "7"`);
  assert.equal(await evaluate(`document.querySelectorAll(".pi-module.marked").length`), 23);
  assert.equal(await evaluate(`document.querySelector("#array-module-H-04-T").getAttribute("aria-pressed")`), "true");
  assert.match(await evaluate(`document.querySelector(".pi-stats").innerText`), /7\s+With demo inspections/);
  await screenshot("full-site");
  for (const [width, height] of [[1366, 768], [1440, 900], [1920, 1080]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await waitFor(`innerWidth === ${width}`);
    assert.ok(await evaluate(`(() => {
      const tabs = document.querySelector(".pi-tabs");
      return document.documentElement.scrollWidth <= innerWidth && tabs.scrollWidth <= tabs.clientWidth;
    })()`), `Page and panel tabs must fit at ${width} × ${height}.`);
    await screenshot(`desktop-${width}`);
  }
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  assert.match(await evaluate(`document.querySelector(".pi-detail-body").innerText`), /IC15/);
  const detailsClip = await evaluate(`(() => {
    const box = document.querySelector(".pi-details").getBoundingClientRect();
    return { x:box.left+scrollX, y:box.top+scrollY, width:box.width, height:Math.min(box.height, innerHeight-box.top), scale:1 };
  })()`);
  await screenshot("panel-details", detailsClip);

  await evaluate(`document.querySelector("#pi-panel-search").focus(); document.querySelector("#pi-panel-search").select();`);
  await send("Input.insertText", { text: "h04t" });
  await button("Find panel");
  assert.equal(await evaluate(`document.querySelector("#pi-panel-search").value`), "H-04-T");
  await waitFor(`document.querySelector(".pi-array").style.width === "800%"`);
  await button("Fit Site");
  await button("Zoom in");
  assert.equal(await evaluate(`document.querySelector(".pi-array").style.width`), "200%");
  await button("Zoom out");
  assert.equal(await evaluate(`document.querySelector(".pi-array").style.width`), "100%");
  await button("Read Numbers");
  assert.equal(await evaluate(`document.querySelectorAll(".pi-position-number").length`), 1270);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll(".pi-position-number")).filter(label => label.textContent === "82*").length`), 1);
  const renderedRows = await evaluate(`(() => {
    const rows = {};
    for (const label of document.querySelectorAll(".pi-position-number")) {
      const {row, position} = label.dataset;
      const stem = "#array-module-" + row + "-" + position.padStart(2, "0");
      const top = document.querySelector(stem + "-T").getBoundingClientRect();
      const bottom = document.querySelector(stem + "-B").getBoundingClientRect();
      const number = label.getBoundingClientRect();
      if (Math.abs(number.left + number.width / 2 - top.left - top.width / 2) > 1 ||
          Math.abs(top.left - bottom.left) > 0.1 || number.top < top.bottom || number.bottom > bottom.top ||
          number.height < 11 || label.textContent.replace("*","") !== position) {
        throw new Error("Misaligned or unreadable position " + row + "-" + position);
      }
      (rows[row] ??= []).push(Number(position));
    }
    return rows;
  })()`);
  assert.equal(Object.keys(renderedRows).join(""), "ABCDEFGHIJKLMNOP");
  for (const [row, positions] of Object.entries(renderedRows)) {
    const last = row <= "E" ? 108 : row === "F" ? 82 : row <= "L" ? 54 : 81;
    assert.deepEqual(positions, Array.from({length:last}, (_, index) => index + 1), row);
  }
  assert.equal(await evaluate(`document.querySelector("#array-module-H-04-T").getAttribute("x") ===
    document.querySelector("#array-module-H-04-B").getAttribute("x")`), true);
  await screenshot("detail-zoom");
  const viewport = await evaluate(`(() => {const map = document.querySelector(".pi-viewport"), r = map.getBoundingClientRect();
    return {x:r.left+150,y:r.top+130,scroll:map.scrollLeft};})()`);
  await send("Input.dispatchMouseEvent", {type:"mousePressed", button:"left", buttons:1, clickCount:1, x:viewport.x, y:viewport.y});
  await send("Input.dispatchMouseEvent", {type:"mouseMoved", button:"left", buttons:1, x:viewport.x+85, y:viewport.y});
  await send("Input.dispatchMouseEvent", {type:"mouseReleased", button:"left", buttons:0, clickCount:1, x:viewport.x+85, y:viewport.y});
  assert.ok(await evaluate(`document.querySelector(".pi-viewport").scrollLeft`) < viewport.scroll);
  assert.equal(await evaluate(`document.querySelector(".pi-identity h3").textContent`), "H-04-T");

  await evaluate(`document.querySelector("#pi-panel-search").focus(); document.querySelector("#pi-panel-search").select();`);
  await send("Input.insertText", { text: "H-04-B" });
  await button("Find panel");
  await waitFor(`document.querySelector(".pi-identity h3").textContent === "H-04-B"`);
  assert.equal(await evaluate(`document.querySelector("#array-module-H-04-B").getAttribute("aria-pressed")`), "true");
  const modulePoint = await evaluate(`(() => {
    const rect = document.querySelector("#array-module-H-04-T").getBoundingClientRect();
    return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};
  })()`);
  await send("Input.dispatchMouseEvent", {type:"mousePressed", button:"left", buttons:1, clickCount:1, ...modulePoint});
  await send("Input.dispatchMouseEvent", {type:"mouseReleased", button:"left", buttons:0, clickCount:1, ...modulePoint});
  await button("Inspections");
  await waitFor(`document.querySelector(".pi-identity h3").textContent === "H-04-T" && document.querySelector('[aria-label="Simulated Thermal"]')`);
  await button("Simulated Thermal");
  assert.match(await evaluate(`document.querySelector("dialog[open]").textContent`), /NOT REAL DRONE MEASUREMENTS/);
  await evaluate(`document.querySelector("dialog[open]").close()`);
  await button("Simulated RGB");
  assert.match(await evaluate(`document.querySelector("dialog[open]").textContent`), /Simulated RGB/);
  await send("Input.dispatchKeyEvent", {type:"keyDown", key:"Escape", code:"Escape", windowsVirtualKeyCode:27});
  await waitFor(`!document.querySelector("dialog[open]")`);
  await button("Measurements");
  assert.match(await evaluate(`document.querySelector(".pi-compare").innerText`), /34\.5 °C/);
  assert.match(await evaluate(`document.querySelector(".pi-compare").innerText`), /36\.7 °C/);
  await evaluate(`(() => {
    const body = document.querySelector(".pi-detail-body");
    const comparison = document.querySelector(".pi-compare");
    comparison.scrollIntoView({block:"center", behavior:"instant"});
  })()`);
  await waitFor(`document.querySelector(".pi-compare h4").getBoundingClientRect().bottom < innerHeight - 120`);
  const comparisonClip = await evaluate(`(() => {
    const box = document.querySelector(".pi-compare").getBoundingClientRect();
    return { x:box.left+scrollX, y:box.top+scrollY, width:box.width, height:Math.min(box.height, innerHeight-box.top), scale:1 };
  })()`);
  await screenshot("comparison", comparisonClip);
  await button("2026-10-28");
  assert.match(await evaluate(`document.querySelector(".pi-detail-body").innerText`), /Visit.*2026-10-28/);
  assert.match(await evaluate(`document.querySelector(".pi-detail-body").innerText`), /Not measured/);
  assert.equal(await evaluate(`document.querySelector(".pi-detail-body").scrollTop`), 0);
  await button("Maintenance");
  assert.ok(await evaluate(`document.querySelector(".pi-record")?.textContent.length`));
  await button("Files");
  assert.match(await evaluate(`document.querySelector(".pi-detail-body").innerText`), /IC15/);
  await button("Inspections");
  await button("Return to selected module");
  assert.equal(await evaluate(`document.activeElement.id`), "array-module-H-04-T");
  await send("Input.dispatchKeyEvent", {type:"keyDown", key:"ArrowDown", code:"ArrowDown", windowsVirtualKeyCode:40});
  await waitFor(`document.querySelector(".pi-identity h3").textContent === "H-04-B"`);
  await evaluate(`(() => {
    const fetchOriginal = window.fetch;
    window.fetch = (input, options) => {
      if (!String(input).includes("/panels/G-02-B")) return fetchOriginal.call(window, input, options);
      window.fetch = fetchOriginal;
      return new Promise((_, reject) => { window.rejectAuditRequest = () => reject(new Error("Test connection interruption")); });
    };
  })()`);
  await evaluate(`document.querySelector("#pi-panel-search").focus(); document.querySelector("#pi-panel-search").select();`);
  await send("Input.insertText", { text: "G-02-B" });
  await button("Find panel");
  await waitFor(`typeof window.rejectAuditRequest === "function" && document.querySelector(".pi-detail-body").innerText.includes("Loading inspection evidence")`);
  assert.doesNotMatch(await evaluate(`document.querySelector(".pi-detail-body").innerText`), /Not measured|Awaiting upload/);
  await evaluate(`window.rejectAuditRequest()`);
  await waitFor(`document.querySelector(".pi-detail-body [role=alert]")`);
  await button("Retry evidence");
  await waitFor(`document.querySelector(".pi-identity h3").textContent === "G-02-B" && document.querySelector(".pi-detail-body").innerText.includes("Inspection history (0)")`);
  await evaluate(`(() => {
    const row = document.querySelector(".pi-map-tools select");
    row.value = "G";
    row.dispatchEvent(new Event("change", {bubbles:true}));
  })()`);
  assert.equal(await evaluate(`document.querySelectorAll(".pi-module").length`), 108);
  await button("Fit Site");
  assert.equal(await evaluate(`document.querySelectorAll(".pi-position-number").length`), 0);
  assert.equal(await evaluate(`document.querySelectorAll(".pi-module").length`), 2540);
  await evaluate(`document.querySelector("#pi-panel-search").focus(); document.querySelector("#pi-panel-search").select();`);
  await send("Input.insertText", { text: "A-01-T" });
  await button("Find panel");
  await waitFor(`document.querySelector(".pi-array").style.width === "800%" && document.querySelector(".pi-identity h3").textContent === "A-01-T"`);
  await screenshot("row-numbering-restart");
  await button("Fit Site");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await waitFor(`innerWidth === 390`);
  await evaluate(`window.scrollBy({top:document.querySelector(".pi-explorer").getBoundingClientRect().top -
    document.querySelector(".dashboard-header").getBoundingClientRect().bottom - 8, behavior:"instant"})`);
  await screenshot("mobile");
  assert.ok(await evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`),
    "The mobile document must fit its viewport.");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await button("Site Layout");
  await waitFor(`document.querySelectorAll(".inverter-map g[role=button]").length === 8`);
  await evaluate(`window.scrollTo(0,0); document.querySelector('.inverter-map g[aria-label="INV.04"]').dispatchEvent(new MouseEvent("click",{bubbles:true}))`);
  await waitFor(`document.querySelector(".inverter-page footer")?.textContent.includes("Proposed INVT-004")`);
  assert.match(await evaluate(`document.querySelector(".inverter-page footer").textContent`), /Unverified/);
    if (await evaluate(`[...document.querySelectorAll(".inverter-page button")].some(button => button.textContent.trim() === "View proposed configuration")`)) {
      await button("View proposed configuration");
      await waitFor(`/INVT-004.*CPS.*125KTL/.test(document.querySelector(".inverter-page").textContent)`);
    }
  await screenshot("engineering-site-layout");
  await button("Array Map");
  assert.equal(await evaluate(`document.querySelector(".pi-identity h3").textContent`), "A-01-T");
  }
  if (process.argv.includes("--demo-write") || process.argv.includes("--write-only")) {
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await enter("#pi-panel-search", "H-04-T");
    await button("Find panel");
    await waitFor(`[...document.querySelectorAll(".pi button")].some(button => button.textContent === "New Inspection")`);
    await button("New Inspection");
    await waitFor(`document.querySelector(".pi-capture form input[required]:enabled")`);
    const inputs = ".pi-capture form input[required]";
    const timestamp = new Date().toISOString();
    await enter(inputs, timestamp);
    const source = "Synthetic Edge browser verification";
    await evaluate(`document.querySelectorAll(${JSON.stringify(inputs)})[1].focus()`);
    await send("Input.insertText", {text: source});
    await button("Add reading or finding");
    await fillVisit("Measurement name", "module_temperature");
    await selectOption(await visitField("Documented quantity", "select"), "temperature");
    await fillVisit("Source numeric value", "35.25");
    await selectOption(await visitField("Source measurement unit", "select"), "degC");
    await evaluate(`document.querySelector(".pi-capture").scrollIntoView({block:"center"})`);
    await screenshot("new-inspection");
    await button("Save new visit");
    await waitFor(`document.querySelector(".pi-capture [role=status]")?.textContent.includes("saved")`);
    await waitFor(`document.querySelector(".pi-visit select")?.selectedOptions[0]?.textContent.includes(${JSON.stringify(timestamp.slice(0, 19))})`);
    await button("Upload File");
    await loadVisitForm();
    const png = join(output, "synthetic-upload-fixture.png");
    await writeFile(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=", "base64"));
    await setEvidenceFile(png);
    await waitFor(`document.querySelector(".pi-capture form").textContent.includes("synthetic-upload-fixture.png")`);
    const csv = join(output, "synthetic-upload-fixture.csv");
    await writeFile(csv, "metric,value\nmodule_temperature,35\n");
    await evaluate(`(() => {
      const type = [...document.querySelectorAll(".pi-capture select")].find(select => [...select.options].some(option => option.value === "csv"));
      type.value = "csv";
      type.dispatchEvent(new Event("change", {bubbles:true}));
    })()`);
    await setEvidenceFile(csv);
    await waitFor(`document.querySelector(".pi-capture form").textContent.includes("synthetic-upload-fixture.csv")`);
    await enter(`.pi-capture form input[required]`, "Attach synthetic test worksheet");
    await button("Save immutable amendment");
    const uploadedFile = `[...document.querySelectorAll(".pi-detail-body a")].some(link => link.textContent === "synthetic-upload-fixture.csv")`;
    await waitFor(uploadedFile);
    await button("Measurements");
    await button("Edit measurement");
    await loadVisitForm();
    await fillVisit("Source numeric value", "36.25");
    await fillVisit("Correction reason", "Synthetic worksheet correction");
    await button("Save immutable amendment");
    await waitFor(`document.querySelector(".pi-detail-body dd")?.textContent.includes("36.25")`);
    const note = "Synthetic browser note " + timestamp;
    await button("Add Note");
    await waitFor(`document.querySelector(".pi-notes textarea")`);
    await enter(".pi-notes input", "Browser QA");
    await enter(".pi-notes textarea", note);
    await button("Save note");
    await waitFor(`document.querySelector(".pi-notes [role=status]")?.textContent === "Note saved."`);
    await button("Maintenance");
    await button("Add Maintenance");
    await evaluate(`document.querySelector(".pi-notes input[type=date]").value = "2026-11-18"`);
    const work = "Synthetic service " + timestamp;
    await enter(".pi-notes input[name=work]", work);
    await selectOption(".pi-notes select[name=status]", "planned");
    await button("Save maintenance");
    const record = `[...document.querySelectorAll(".pi-record")].find(item => item.textContent.includes(${JSON.stringify(work)}))`;
    await waitFor(record);
    await evaluate(`(${record}).querySelector("button").click()`);
    await selectOption(".pi-record select[name=status]", "completed");
    await enter(".pi-record textarea[name=notes]", "Synthetic service completed");
    await button("Save status");
    await waitFor(`(${record})?.textContent.includes("Synthetic service completed")`);
    await send("Page.reload");
    await waitFor(`performance.getEntriesByType("navigation")[0]?.type === "reload" &&
      document.querySelector(".pi-identity h3")?.textContent === "H-04-T"`);
    await button("Files");
    await waitFor(uploadedFile);
    await waitFor(`[...document.querySelectorAll(".pi-detail-body a")].some(link => link.textContent === "synthetic-upload-fixture.png")`);
    await screenshot("persisted-synthetic-upload");
    await button("Notes");
    await waitFor(`document.querySelector(".pi-notes").textContent.includes(${JSON.stringify(note)})`);
    await button("Maintenance");
    await waitFor(`(${record})?.textContent.includes("Synthetic service completed")`);
    await evaluate(`(${record}).querySelector("details").open = true`);
    await screenshot("maintenance-history");
    await button("Inspections");
    await waitFor(`document.querySelector(".pi-detail-body").textContent.includes("36.25")`);
    await button("Open full visit record");
    await button("Original evidence");
    await waitFor(`document.querySelector(".pi-detail-body section[aria-label^=Visit] table")?.textContent.includes("35.25")`);
    console.log("Edge passed: synthetic measurements, RGB/CSV uploads, notes, maintenance status history, corrections, and original readings across reload.");
  }
  if (process.argv.includes("--review-fixture")) {
    await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
    await evaluate(`window.scrollTo(0,0)`);
    await button("Notes");
    await waitFor(`document.querySelector(".pi-notes button")?.textContent === "Add note"`);
    await button("Add note");
    await screenshot("add-note");
    const note = "Disposable synthetic note " + Date.now();
    await enter(".pi-notes input", "Browser QA");
    await enter(".pi-notes textarea", note);
    await button("Save note");
    await waitFor(`document.querySelector(".pi-notes [role=status]")?.textContent === "Note saved."`);
    await button("Edit note");
    await enter(".pi-notes textarea", note + " amended");
    await button("Save note");
    await waitFor(`document.querySelector(".pi-notes summary")?.textContent.includes("Previous versions")`);
    await send("Page.reload");
    await waitFor(`document.querySelector(".pi-details .pi-tabs")`);
    await enter("#pi-panel-search", "A-01-T");
    await button("Find panel");
    await button("Notes");
    await waitFor(`document.querySelector(".pi-notes")?.textContent.includes(${JSON.stringify(note + " amended")})`);

    await evaluate(`(() => {
      const mode = document.querySelector('select[aria-label="Data mode"]');
      mode.value = "live";
      mode.dispatchEvent(new Event("change", { bubbles:true }));
    })()`);
    await enter("#pi-panel-search", "H-04-T");
    await button("Find panel");
    await button("Overview");
    await waitFor(`[...document.querySelectorAll(".pi-detail-body summary")].some(summary => summary.textContent === "Edit verified metadata")`);
    assert.equal(await evaluate(`document.querySelector(".pi-detail-body").textContent.includes("Disposable synthetic browser fixture")`), true,
      "Write checks require the isolated disposable visit fixture.");
    await evaluate(`[...document.querySelectorAll(".pi-detail-body summary")].forEach(summary => {
      if (["Equipment details", "Edit verified metadata"].includes(summary.textContent)) summary.parentElement.open = true;
    })`);
    await waitFor(`document.querySelector(".pi-detail-body .pi-notes input")`);
    await enter(".pi-detail-body .pi-notes input", "Disposable QA manufacturer");
    await enter(".pi-detail-body .pi-notes input[required]", "Disposable fixture documentation");
    await button("Save details");
    await waitFor(`document.querySelector(".pi-detail-body").textContent.includes("Verified metadata saved.")`);
    await button("Measurements");
    await waitFor(`[...document.querySelectorAll(".pi button")].some(button => button.textContent === "Edit measurement")`);
    await button("Edit measurement");
    await waitFor(`[...document.querySelectorAll(".pi button")].some(button => button.textContent === "Load recorded visit" && !button.disabled)`);
    await button("Load recorded visit");
    await waitFor(`document.querySelector(".pi-capture form")`);
    await screenshot("edit-measurement");
    await evaluate(`document.querySelector(".pi-capture input[type=file]").scrollIntoView({block:"center"})`);
    await screenshot("file-upload");
    const photograph = join(output, "synthetic-upload-fixture.png");
    await writeFile(photograph, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=", "base64"));
    const tree = await send("DOM.getDocument");
    const fileInput = await send("DOM.querySelector", { nodeId: tree.root.nodeId, selector: ".pi-capture input[type=file]" });
    if (!await evaluate(`document.querySelector(".pi-capture form").textContent.includes("synthetic-upload-fixture.png")`)) {
      await send("DOM.setFileInputFiles", { nodeId: fileInput.nodeId, files: [photograph] });
    }
    await waitFor(`document.querySelector(".pi-capture form").textContent.includes("synthetic-upload-fixture.png")`);
    await evaluate(`document.querySelector(".pi-capture form").scrollIntoView({block:"start"})`);
    const inputs = await evaluate(`Array.from(document.querySelectorAll(".pi-capture form input")).map(input => input.closest("label")?.textContent)`);
    for (const [label, value] of [["Correction reason", "Disposable browser QA correction"], ["Source numeric value", "38.25"]]) {
      assert.ok(inputs.includes(label), label);
      const index = inputs.indexOf(label);
      await evaluate(`(() => { const input = document.querySelectorAll(".pi-capture form input")[${index}]; input.focus(); input.select(); })()`);
      await send("Input.insertText", { text: value });
    }
    await button("Save immutable amendment");
    await waitFor(`document.querySelector(".pi-capture [role=status]")?.textContent.includes("saved") && document.querySelector(".pi-detail-body").textContent.includes("38.25")`);
    await button("Files");
    await waitFor(`[...document.querySelectorAll(".pi-detail-body a")].some(link => link.textContent === "synthetic-upload-fixture.png")`);
    await button("Inspections");
    await button("New Inspection");
    await waitFor(`document.querySelector(".pi-capture form input[required]:enabled")`);
    await enter(".pi-capture form input[required]", "2026-11-13T10:00:00Z");
    await evaluate(`(() => { const input = document.querySelectorAll(".pi-capture form input[required]")[1]; input.focus(); input.select(); })()`);
    await send("Input.insertText", { text: "Disposable synthetic browser fixture" });
    await button("Save new visit");
    await waitFor(`document.querySelector(".pi-capture [role=status]")?.textContent.includes("saved") &&
      document.querySelector(".pi-visit select")?.selectedOptions[0]?.textContent.includes("2026-11-13")`);
    console.log("Disposable browser fixture passed: note create and edit across reload, metadata edit, measurement correction, image upload and visit association, and new visit.");
  }
  assert.deepEqual(errors, []);
  if (!process.argv.includes("--write-only")) console.log("Edge passed: sidebar, geometry, pan, pointer and keyboard selection, RGB/thermal dialogs, comparison, evidence loading/retry, missing and empty states, maintenance, documents, engineering site layout, and responsive viewports.");
  }
  console.log(output);
} finally {
  socket?.close();
  browser.kill();
}
