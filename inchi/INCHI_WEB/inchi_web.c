/* #define _GNU_SOURCE // https://stackoverflow.com/a/61306222 */
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include "inchi_api.h"
#include <emscripten.h>

/*
 * Note on the use of malloc():
 *
 * There are no NULL checks for the results of malloc calls because we are compiling with
 * ABORTING_MALLOC=1 (default setting). Tests should make sure that turning ALLOW_MEMORY_GROWTH
 * on is not required.
 * See https://github.com/emscripten-core/emscripten/blob/fa339b76424ca9fbe5cf15faea0295d2ac8d58cc/src/settings.js#L131
 *
 * What happens when malloc aborts? We can catch a JS exception.
 * See https://github.com/emscripten-core/emscripten/issues/9715
 */

/*
 * A (too) simple C version of to_json.
 * TODO: Escape strings to make sure we always have valid JSON. YAY!!!!! ;(
 */
/*char* to_json(int return_code, char *inchi, char *auxinfo, char *message) {
  char *json;

  if (asprintf(&json,
               "{\"return_code\":\"%i\",\"inchi\":\"%s\",\"auxinfo\":\"%s\",\"message\":\"%s\"}",
               return_code,
               inchi,
               auxinfo,
               message) < 0) {
    return NULL;
  }

  return json;
}*/

/*
 * Safe way to serialize to JSON.
 * See https://livebook.manning.com/book/webassembly-in-action/c-emscripten-macros/v-7/67
 */
EM_JS(char*, to_json_inchi, (int return_code, char *inchi, char *auxinfo, char *message, char *log), {
  const json = JSON.stringify({
    "return_code": return_code,
    "inchi": Module.UTF8ToString(inchi),
    "auxinfo": Module.UTF8ToString(auxinfo),
    "message": Module.UTF8ToString(message),
    "log": Module.UTF8ToString(log)
  });

  const byteCount = Module.lengthBytesUTF8(json) + 1;
  const jsonPtr = Module._malloc(byteCount);
  Module.stringToUTF8(json, jsonPtr, byteCount);

  return jsonPtr;
});

char* inchi_from_molfile(char *molfile, char *options) {
  int ret;
  inchi_Output *output;
  char *json;

  output = malloc(sizeof(*output));
  memset(output, 0, sizeof(*output));

  ret = MakeINCHIFromMolfileText(molfile, options, output);

  switch(ret) {
    case mol2inchi_Ret_OKAY: {
      json = to_json_inchi(0, output->szInChI, output->szAuxInfo, "", "");
      break;
    }
    case mol2inchi_Ret_WARNING: {
      json = to_json_inchi(1, output->szInChI, output->szAuxInfo, output->szMessage, output->szLog);
      break;
    }
    case mol2inchi_Ret_EOF:
    case mol2inchi_Ret_ERROR:
    case mol2inchi_Ret_ERROR_get:
    case mol2inchi_Ret_ERROR_comp: {
      json = to_json_inchi(-1, "", "", output->szMessage, output->szLog);
      break;
    }
    default: {
      json = to_json_inchi(-1, "", "", "", "MakeINCHIFromMolfileText: Unknown return code");
    }
  }

  FreeINCHI(output);
  free(output);

  /*
   * Potential memory leak: Will the caller (emscripten) free this string?
   */
  return json;
}

EM_JS(char*, to_json_inchikey, (int return_code, char *inchikey, char *message), {
  const json = JSON.stringify({
    "return_code": return_code,
    "inchikey": Module.UTF8ToString(inchikey),
    "message": Module.UTF8ToString(message)
  });

  const byteCount = Module.lengthBytesUTF8(json) + 1;
  const jsonPtr = Module._malloc(byteCount);
  Module.stringToUTF8(json, jsonPtr, byteCount);

  return jsonPtr;
});

char* inchikey_from_inchi(char* inchi) {
  int ret;
  char szINCHIKey[28], szXtra1[65], szXtra2[65];
  char *json;

  ret = GetINCHIKeyFromINCHI(inchi, 0, 0, szINCHIKey, szXtra1, szXtra2);

  switch(ret) {
    case INCHIKEY_OK: {
      json = to_json_inchikey(0, szINCHIKey, "");
      break;
    }
    case INCHIKEY_UNKNOWN_ERROR: {
      json = to_json_inchikey(-1, "", "GetINCHIKeyFromINCHI: Unknown program error");
      break;
    }
    case INCHIKEY_EMPTY_INPUT: {
      json = to_json_inchikey(-1, "", "GetINCHIKeyFromINCHI: Source string is empty");
      break;
    }
    case INCHIKEY_INVALID_INCHI_PREFIX: {
      json = to_json_inchikey(-1, "", "GetINCHIKeyFromINCHI: Invalid InChI prefix or invalid version (not 1)");
      break;
    }
    case INCHIKEY_NOT_ENOUGH_MEMORY: {
      json = to_json_inchikey(-1, "", "GetINCHIKeyFromINCHI: Not enough memory");
      break;
    }
    case INCHIKEY_INVALID_INCHI: {
      json = to_json_inchikey(-1, "", "GetINCHIKeyFromINCHI: Source InChI has invalid layout");
      break;
    }
    case INCHIKEY_INVALID_STD_INCHI: {
      json = to_json_inchikey(-1, "", "GetINCHIKeyFromINCHI: Source standard InChI has invalid layout");
      break;
    }
    default: {
      json = to_json_inchikey(-1, "", "GetINCHIKeyFromINCHI: Unknown return code");
    }
  }

  // Caller should free this.
  return json;
}
