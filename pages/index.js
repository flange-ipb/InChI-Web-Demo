"use strict";

/*
 * WASM module(s) initialization
 *
 * Calling the factory function return a Promise which resolves to the module object.
 * See https://github.com/emscripten-core/emscripten/blob/fa339b76424ca9fbe5cf15faea0295d2ac8d58cc/src/settings.js#L1183
 */
const inchiModulePromises = {
  "1.06": inchiModule106()
};

const availableInchiVersions = Object.keys(inchiModulePromises);

/*
 * Initialization of user-selectable parameters
 */
function onBodyLoad() {
  addInchiVersionsToSelect("tab1-inchiversion");
  addInchiOptions("tab1-options", () => updateTab1());

  addInchiVersionsToSelect("tab2-inchiversion");
  addInchiOptions("tab2-options", () => updateTab2());
}

function addInchiVersionsToSelect(selectId) {
  availableInchiVersions.forEach(v => {
    const option = document.createElement("option");
    option.innerHTML = v;
    option.value = v;
    document.getElementById(selectId).appendChild(option);
  });
}

const inchiOptions = ["NEWPSOFF", "DoNotAddH", "SNon", "SRel", "SRac", "SUCF", "SUU", "SLUUD", "FixedH", "RecMet", "KET", "15T"];

function addInchiOptions(divId, updateFunction) {
  inchiOptions.forEach(opt => {
    const div = document.createElement("div");
    div.classList.add("form-check", "mb-2");

    const input = document.createElement("input");
    input.id = divId + "-" + opt;
    input.classList.add("form-check-input");
    input.type = "checkbox";
    input.value = opt;
    input.addEventListener("change", updateFunction);

    const label = document.createElement("label");
    label.classList.add("form-check-label");
    label.htmlFor = input.id;
    label.innerHTML = opt;

    div.appendChild(input);
    div.appendChild(label);
    document.getElementById(divId).appendChild(div);
  });
}

/*
 * Glue code to invoke the C functions in inchi_web.c
 *
 * Char pointers returned by inchi_from_molfile and inchikey_from_inchi need to be
 * freed here.
 * See https://github.com/emscripten-core/emscripten/issues/6484 (emscripten does
 * not do this on its own when using "string" as return type)
 */
async function inchiFromMolfile(molfile, options, inchiVersion) {
  const module = await inchiModulePromises[inchiVersion];
  const ptr = module.ccall("inchi_from_molfile", "number", ["string", "string"], [molfile, options]);
  const result = module.UTF8ToString(ptr);
  module._free(ptr);

  return JSON.parse(result);
}

async function inchikeyFromInchi(inchi, inchiVersion) {
  const module = await inchiModulePromises[inchiVersion];
  const ptr = module.ccall("inchikey_from_inchi", "number", ["string"], [inchi]);
  const result = module.UTF8ToString(ptr);
  module._free(ptr)

  return JSON.parse(result);
}

/*
 * Update actions (when user changes inputs)
 */
async function updateTab1() {
  const molfile = await getKetcher().getMolfile();
  const options = collectOptions("tab1-options");
  const inchiVersion = document.getElementById("tab1-inchiversion").value;

  await convertMolfileToInchiAndWriteResults(molfile, options, inchiVersion, "tab1-inchi", "tab1-inchikey", "tab1-auxinfo", "tab1-logs");
}

async function updateTab2() {
  const molfile = document.getElementById("molfileTextarea").value;
  const options = collectOptions("tab2-options");
  const inchiVersion = document.getElementById("tab2-inchiversion").value;

  await convertMolfileToInchiAndWriteResults(molfile, options, inchiVersion, "tab2-inchi", "tab2-inchikey", "tab2-auxinfo", "tab2-logs");
}

async function convertMolfileToInchiAndWriteResults(molfile, options, inchiVersion, inchiTextElementId, inchikeyTextElementId, auxinfoTextElementId, logTextElementId) {
  writeResult("", inchiTextElementId);
  writeResult("", inchikeyTextElementId);
  writeResult("", auxinfoTextElementId);
  writeResult("", logTextElementId);

  let inchiResult;
  try {
    inchiResult = await inchiFromMolfile(molfile, options, inchiVersion);
  } catch(e) {
    writeResult(e, logTextElementId);
    return;
  }
  writeResult(inchiResult.inchi, inchiTextElementId);
  writeResult(inchiResult.auxinfo, auxinfoTextElementId);

  const log = [];
  if (inchiResult.log != "") {
    log.push(inchiResult.log);
  }

  if ((inchiResult.return_code != -1) && (inchiResult.inchi != "")) {
    let inchikeyResult;
    try {
      inchikeyResult = await inchikeyFromInchi(inchiResult.inchi, inchiVersion);
    } catch(e) {
      log.push(e);
    }
    writeResult(inchikeyResult.inchikey, inchikeyTextElementId);

    if ((inchikeyResult == -1) && (inchikeyResult.message != "")) {
      log.push(inchikeyResult.message);
    }
  }

  writeResult(log.join("\n"), logTextElementId);
}

function collectOptions(tabOptionsId) {
  /*
   * Efficient way to collect all options.
   * Idea from https://github.com/rapodaca/inchi-wasm/blob/master/web/index.html#L166
   */
  const elements = document.querySelectorAll("[id=" + tabOptionsId + "] div.form-check input.form-check-input");
  return Array.from(elements).filter(e => e.checked).map(e => "-" + e.value).join(" ");
}

function writeResult(text, id) {
  document.getElementById(id).innerHTML = text;
}

/*
 * Ketcher
 */
function getKetcher() {
  return document.getElementById("ketcher").contentWindow.ketcher;
}

function onKetcherLoaded() {
  const ketcher = getKetcher();

  // Chrome fires the onload event too early, so we have to wait until 'ketcher' exists.
  if (ketcher) {
    ketcher.editor.subscribe("change", () => updateTab1());
  } else {
    setTimeout(() => onKetcherLoaded(), 0);
  }
}

/*
 * Drag-and-drop into the Molfile textarea
 */
function onTextareaDragover(event) {
  event.stopPropagation();
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
}

async function onMolfileTextareaDrop(event) {
  event.stopPropagation();
  event.preventDefault();

  const content = await extractContent(event.dataTransfer);
  if (!content) {
    return;
  }

  document.getElementById("molfileTextarea").value = content;
  await updateTab2();
}

async function extractContent(dataTransfer) {
  const items = dataTransfer.items;
  if (!items || items.length == 0) {
    return null;
  }
  const item = items[0];

  if (item.kind === "file") {
    return await item.getAsFile().text();
  } else if (item.kind === "string") {
    return new Promise(resolve => {
      item.getAsString(data => resolve(data));
    });
  }
  return null;
}
