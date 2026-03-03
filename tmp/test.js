"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/generated/store-client/runtime/library.js
var require_library = __commonJS({
  "src/generated/store-client/runtime/library.js"(exports2, module2) {
    "use strict";
    var yu = Object.create;
    var jt = Object.defineProperty;
    var bu = Object.getOwnPropertyDescriptor;
    var Eu = Object.getOwnPropertyNames;
    var wu = Object.getPrototypeOf;
    var xu = Object.prototype.hasOwnProperty;
    var Do = (e, r) => () => (e && (r = e(e = 0)), r);
    var ue = (e, r) => () => (r || e((r = { exports: {} }).exports, r), r.exports);
    var tr = (e, r) => {
      for (var t in r) jt(e, t, { get: r[t], enumerable: true });
    };
    var Oo = (e, r, t, n) => {
      if (r && typeof r == "object" || typeof r == "function") for (let i of Eu(r)) !xu.call(e, i) && i !== t && jt(e, i, { get: () => r[i], enumerable: !(n = bu(r, i)) || n.enumerable });
      return e;
    };
    var O = (e, r, t) => (t = e != null ? yu(wu(e)) : {}, Oo(r || !e || !e.__esModule ? jt(t, "default", { value: e, enumerable: true }) : t, e));
    var vu = (e) => Oo(jt({}, "__esModule", { value: true }), e);
    var hi = ue((_g, is) => {
      "use strict";
      is.exports = (e, r = process.argv) => {
        let t = e.startsWith("-") ? "" : e.length === 1 ? "-" : "--", n = r.indexOf(t + e), i = r.indexOf("--");
        return n !== -1 && (i === -1 || n < i);
      };
    });
    var as = ue((Ng, ss) => {
      "use strict";
      var Fc = require("node:os"), os = require("node:tty"), de = hi(), { env: G } = process, Qe;
      de("no-color") || de("no-colors") || de("color=false") || de("color=never") ? Qe = 0 : (de("color") || de("colors") || de("color=true") || de("color=always")) && (Qe = 1);
      "FORCE_COLOR" in G && (G.FORCE_COLOR === "true" ? Qe = 1 : G.FORCE_COLOR === "false" ? Qe = 0 : Qe = G.FORCE_COLOR.length === 0 ? 1 : Math.min(parseInt(G.FORCE_COLOR, 10), 3));
      function yi(e) {
        return e === 0 ? false : { level: e, hasBasic: true, has256: e >= 2, has16m: e >= 3 };
      }
      function bi(e, r) {
        if (Qe === 0) return 0;
        if (de("color=16m") || de("color=full") || de("color=truecolor")) return 3;
        if (de("color=256")) return 2;
        if (e && !r && Qe === void 0) return 0;
        let t = Qe || 0;
        if (G.TERM === "dumb") return t;
        if (process.platform === "win32") {
          let n = Fc.release().split(".");
          return Number(n[0]) >= 10 && Number(n[2]) >= 10586 ? Number(n[2]) >= 14931 ? 3 : 2 : 1;
        }
        if ("CI" in G) return ["TRAVIS", "CIRCLECI", "APPVEYOR", "GITLAB_CI", "GITHUB_ACTIONS", "BUILDKITE"].some((n) => n in G) || G.CI_NAME === "codeship" ? 1 : t;
        if ("TEAMCITY_VERSION" in G) return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(G.TEAMCITY_VERSION) ? 1 : 0;
        if (G.COLORTERM === "truecolor") return 3;
        if ("TERM_PROGRAM" in G) {
          let n = parseInt((G.TERM_PROGRAM_VERSION || "").split(".")[0], 10);
          switch (G.TERM_PROGRAM) {
            case "iTerm.app":
              return n >= 3 ? 3 : 2;
            case "Apple_Terminal":
              return 2;
          }
        }
        return /-256(color)?$/i.test(G.TERM) ? 2 : /^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(G.TERM) || "COLORTERM" in G ? 1 : t;
      }
      function Mc(e) {
        let r = bi(e, e && e.isTTY);
        return yi(r);
      }
      ss.exports = { supportsColor: Mc, stdout: yi(bi(true, os.isatty(1))), stderr: yi(bi(true, os.isatty(2))) };
    });
    var cs = ue((Lg, us) => {
      "use strict";
      var $c = as(), br = hi();
      function ls(e) {
        if (/^\d{3,4}$/.test(e)) {
          let t = /(\d{1,2})(\d{2})/.exec(e) || [];
          return { major: 0, minor: parseInt(t[1], 10), patch: parseInt(t[2], 10) };
        }
        let r = (e || "").split(".").map((t) => parseInt(t, 10));
        return { major: r[0], minor: r[1], patch: r[2] };
      }
      function Ei(e) {
        let { CI: r, FORCE_HYPERLINK: t, NETLIFY: n, TEAMCITY_VERSION: i, TERM_PROGRAM: o, TERM_PROGRAM_VERSION: s, VTE_VERSION: a, TERM: l } = process.env;
        if (t) return !(t.length > 0 && parseInt(t, 10) === 0);
        if (br("no-hyperlink") || br("no-hyperlinks") || br("hyperlink=false") || br("hyperlink=never")) return false;
        if (br("hyperlink=true") || br("hyperlink=always") || n) return true;
        if (!$c.supportsColor(e) || e && !e.isTTY) return false;
        if ("WT_SESSION" in process.env) return true;
        if (process.platform === "win32" || r || i) return false;
        if (o) {
          let u = ls(s || "");
          switch (o) {
            case "iTerm.app":
              return u.major === 3 ? u.minor >= 1 : u.major > 3;
            case "WezTerm":
              return u.major >= 20200620;
            case "vscode":
              return u.major > 1 || u.major === 1 && u.minor >= 72;
            case "ghostty":
              return true;
          }
        }
        if (a) {
          if (a === "0.50.0") return false;
          let u = ls(a);
          return u.major > 0 || u.minor >= 50;
        }
        switch (l) {
          case "alacritty":
            return true;
        }
        return false;
      }
      us.exports = { supportsHyperlink: Ei, stdout: Ei(process.stdout), stderr: Ei(process.stderr) };
    });
    var ps = ue((Kg, qc) => {
      qc.exports = { name: "@prisma/internals", version: "6.19.2", description: "This package is intended for Prisma's internal use", main: "dist/index.js", types: "dist/index.d.ts", repository: { type: "git", url: "https://github.com/prisma/prisma.git", directory: "packages/internals" }, homepage: "https://www.prisma.io", author: "Tim Suchanek <suchanek@prisma.io>", bugs: "https://github.com/prisma/prisma/issues", license: "Apache-2.0", scripts: { dev: "DEV=true tsx helpers/build.ts", build: "tsx helpers/build.ts", test: "dotenv -e ../../.db.env -- jest --silent", prepublishOnly: "pnpm run build" }, files: ["README.md", "dist", "!**/libquery_engine*", "!dist/get-generators/engines/*", "scripts"], devDependencies: { "@babel/helper-validator-identifier": "7.25.9", "@opentelemetry/api": "1.9.0", "@swc/core": "1.11.5", "@swc/jest": "0.2.37", "@types/babel__helper-validator-identifier": "7.15.2", "@types/jest": "29.5.14", "@types/node": "18.19.76", "@types/resolve": "1.20.6", archiver: "6.0.2", "checkpoint-client": "1.1.33", "cli-truncate": "4.0.0", dotenv: "16.5.0", empathic: "2.0.0", "escape-string-regexp": "5.0.0", execa: "8.0.1", "fast-glob": "3.3.3", "find-up": "7.0.0", "fp-ts": "2.16.9", "fs-extra": "11.3.0", "global-directory": "4.0.0", globby: "11.1.0", "identifier-regex": "1.0.0", "indent-string": "4.0.0", "is-windows": "1.0.2", "is-wsl": "3.1.0", jest: "29.7.0", "jest-junit": "16.0.0", kleur: "4.1.5", "mock-stdin": "1.0.0", "new-github-issue-url": "0.2.1", "node-fetch": "3.3.2", "npm-packlist": "5.1.3", open: "7.4.2", "p-map": "4.0.0", resolve: "1.22.10", "string-width": "7.2.0", "strip-indent": "4.0.0", "temp-dir": "2.0.0", tempy: "1.0.1", "terminal-link": "4.0.0", tmp: "0.2.3", "ts-pattern": "5.6.2", "ts-toolbelt": "9.6.0", typescript: "5.4.5", yarn: "1.22.22" }, dependencies: { "@prisma/config": "workspace:*", "@prisma/debug": "workspace:*", "@prisma/dmmf": "workspace:*", "@prisma/driver-adapter-utils": "workspace:*", "@prisma/engines": "workspace:*", "@prisma/fetch-engine": "workspace:*", "@prisma/generator": "workspace:*", "@prisma/generator-helper": "workspace:*", "@prisma/get-platform": "workspace:*", "@prisma/prisma-schema-wasm": "7.1.1-3.c2990dca591cba766e3b7ef5d9e8a84796e47ab7", "@prisma/schema-engine-wasm": "7.1.1-3.c2990dca591cba766e3b7ef5d9e8a84796e47ab7", "@prisma/schema-files-loader": "workspace:*", arg: "5.0.2", prompts: "2.4.2" }, peerDependencies: { typescript: ">=5.1.0" }, peerDependenciesMeta: { typescript: { optional: true } }, sideEffects: false };
    });
    var Ti = ue((gh, Qc) => {
      Qc.exports = { name: "@prisma/engines-version", version: "7.1.1-3.c2990dca591cba766e3b7ef5d9e8a84796e47ab7", main: "index.js", types: "index.d.ts", license: "Apache-2.0", author: "Tim Suchanek <suchanek@prisma.io>", prisma: { enginesVersion: "c2990dca591cba766e3b7ef5d9e8a84796e47ab7" }, repository: { type: "git", url: "https://github.com/prisma/engines-wrapper.git", directory: "packages/engines-version" }, devDependencies: { "@types/node": "18.19.76", typescript: "4.9.5" }, files: ["index.js", "index.d.ts"], scripts: { build: "tsc -d" } };
    });
    var on = ue((nn) => {
      "use strict";
      Object.defineProperty(nn, "__esModule", { value: true });
      nn.enginesVersion = void 0;
      nn.enginesVersion = Ti().prisma.enginesVersion;
    });
    var hs = ue((Ih, gs) => {
      "use strict";
      gs.exports = (e) => {
        let r = e.match(/^[ \t]*(?=\S)/gm);
        return r ? r.reduce((t, n) => Math.min(t, n.length), 1 / 0) : 0;
      };
    });
    var Di = ue((kh, Es) => {
      "use strict";
      Es.exports = (e, r = 1, t) => {
        if (t = { indent: " ", includeEmptyLines: false, ...t }, typeof e != "string") throw new TypeError(`Expected \`input\` to be a \`string\`, got \`${typeof e}\``);
        if (typeof r != "number") throw new TypeError(`Expected \`count\` to be a \`number\`, got \`${typeof r}\``);
        if (typeof t.indent != "string") throw new TypeError(`Expected \`options.indent\` to be a \`string\`, got \`${typeof t.indent}\``);
        if (r === 0) return e;
        let n = t.includeEmptyLines ? /^/gm : /^(?!\s*$)/gm;
        return e.replace(n, t.indent.repeat(r));
      };
    });
    var vs = ue((jh, tp) => {
      tp.exports = { name: "dotenv", version: "16.5.0", description: "Loads environment variables from .env file", main: "lib/main.js", types: "lib/main.d.ts", exports: { ".": { types: "./lib/main.d.ts", require: "./lib/main.js", default: "./lib/main.js" }, "./config": "./config.js", "./config.js": "./config.js", "./lib/env-options": "./lib/env-options.js", "./lib/env-options.js": "./lib/env-options.js", "./lib/cli-options": "./lib/cli-options.js", "./lib/cli-options.js": "./lib/cli-options.js", "./package.json": "./package.json" }, scripts: { "dts-check": "tsc --project tests/types/tsconfig.json", lint: "standard", pretest: "npm run lint && npm run dts-check", test: "tap run --allow-empty-coverage --disable-coverage --timeout=60000", "test:coverage": "tap run --show-full-coverage --timeout=60000 --coverage-report=lcov", prerelease: "npm test", release: "standard-version" }, repository: { type: "git", url: "git://github.com/motdotla/dotenv.git" }, homepage: "https://github.com/motdotla/dotenv#readme", funding: "https://dotenvx.com", keywords: ["dotenv", "env", ".env", "environment", "variables", "config", "settings"], readmeFilename: "README.md", license: "BSD-2-Clause", devDependencies: { "@types/node": "^18.11.3", decache: "^4.6.2", sinon: "^14.0.1", standard: "^17.0.0", "standard-version": "^9.5.0", tap: "^19.2.0", typescript: "^4.8.4" }, engines: { node: ">=12" }, browser: { fs: false } };
    });
    var As = ue((Bh, _e) => {
      "use strict";
      var Fi = require("node:fs"), Mi = require("node:path"), np = require("node:os"), ip = require("node:crypto"), op = vs(), Ts = op.version, sp = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/mg;
      function ap(e) {
        let r = {}, t = e.toString();
        t = t.replace(/\r\n?/mg, `
`);
        let n;
        for (; (n = sp.exec(t)) != null; ) {
          let i = n[1], o = n[2] || "";
          o = o.trim();
          let s = o[0];
          o = o.replace(/^(['"`])([\s\S]*)\1$/mg, "$2"), s === '"' && (o = o.replace(/\\n/g, `
`), o = o.replace(/\\r/g, "\r")), r[i] = o;
        }
        return r;
      }
      function lp(e) {
        let r = Rs(e), t = B.configDotenv({ path: r });
        if (!t.parsed) {
          let s = new Error(`MISSING_DATA: Cannot parse ${r} for an unknown reason`);
          throw s.code = "MISSING_DATA", s;
        }
        let n = Ss(e).split(","), i = n.length, o;
        for (let s = 0; s < i; s++) try {
          let a = n[s].trim(), l = cp(t, a);
          o = B.decrypt(l.ciphertext, l.key);
          break;
        } catch (a) {
          if (s + 1 >= i) throw a;
        }
        return B.parse(o);
      }
      function up(e) {
        console.log(`[dotenv@${Ts}][WARN] ${e}`);
      }
      function ot(e) {
        console.log(`[dotenv@${Ts}][DEBUG] ${e}`);
      }
      function Ss(e) {
        return e && e.DOTENV_KEY && e.DOTENV_KEY.length > 0 ? e.DOTENV_KEY : process.env.DOTENV_KEY && process.env.DOTENV_KEY.length > 0 ? process.env.DOTENV_KEY : "";
      }
      function cp(e, r) {
        let t;
        try {
          t = new URL(r);
        } catch (a) {
          if (a.code === "ERR_INVALID_URL") {
            let l = new Error("INVALID_DOTENV_KEY: Wrong format. Must be in valid uri format like dotenv://:key_1234@dotenvx.com/vault/.env.vault?environment=development");
            throw l.code = "INVALID_DOTENV_KEY", l;
          }
          throw a;
        }
        let n = t.password;
        if (!n) {
          let a = new Error("INVALID_DOTENV_KEY: Missing key part");
          throw a.code = "INVALID_DOTENV_KEY", a;
        }
        let i = t.searchParams.get("environment");
        if (!i) {
          let a = new Error("INVALID_DOTENV_KEY: Missing environment part");
          throw a.code = "INVALID_DOTENV_KEY", a;
        }
        let o = `DOTENV_VAULT_${i.toUpperCase()}`, s = e.parsed[o];
        if (!s) {
          let a = new Error(`NOT_FOUND_DOTENV_ENVIRONMENT: Cannot locate environment ${o} in your .env.vault file.`);
          throw a.code = "NOT_FOUND_DOTENV_ENVIRONMENT", a;
        }
        return { ciphertext: s, key: n };
      }
      function Rs(e) {
        let r = null;
        if (e && e.path && e.path.length > 0) if (Array.isArray(e.path)) for (let t of e.path) Fi.existsSync(t) && (r = t.endsWith(".vault") ? t : `${t}.vault`);
        else r = e.path.endsWith(".vault") ? e.path : `${e.path}.vault`;
        else r = Mi.resolve(process.cwd(), ".env.vault");
        return Fi.existsSync(r) ? r : null;
      }
      function Ps(e) {
        return e[0] === "~" ? Mi.join(np.homedir(), e.slice(1)) : e;
      }
      function pp(e) {
        !!(e && e.debug) && ot("Loading env from encrypted .env.vault");
        let t = B._parseVault(e), n = process.env;
        return e && e.processEnv != null && (n = e.processEnv), B.populate(n, t, e), { parsed: t };
      }
      function dp(e) {
        let r = Mi.resolve(process.cwd(), ".env"), t = "utf8", n = !!(e && e.debug);
        e && e.encoding ? t = e.encoding : n && ot("No encoding is specified. UTF-8 is used by default");
        let i = [r];
        if (e && e.path) if (!Array.isArray(e.path)) i = [Ps(e.path)];
        else {
          i = [];
          for (let l of e.path) i.push(Ps(l));
        }
        let o, s = {};
        for (let l of i) try {
          let u = B.parse(Fi.readFileSync(l, { encoding: t }));
          B.populate(s, u, e);
        } catch (u) {
          n && ot(`Failed to load ${l} ${u.message}`), o = u;
        }
        let a = process.env;
        return e && e.processEnv != null && (a = e.processEnv), B.populate(a, s, e), o ? { parsed: s, error: o } : { parsed: s };
      }
      function mp(e) {
        if (Ss(e).length === 0) return B.configDotenv(e);
        let r = Rs(e);
        return r ? B._configVault(e) : (up(`You set DOTENV_KEY but you are missing a .env.vault file at ${r}. Did you forget to build it?`), B.configDotenv(e));
      }
      function fp(e, r) {
        let t = Buffer.from(r.slice(-64), "hex"), n = Buffer.from(e, "base64"), i = n.subarray(0, 12), o = n.subarray(-16);
        n = n.subarray(12, -16);
        try {
          let s = ip.createDecipheriv("aes-256-gcm", t, i);
          return s.setAuthTag(o), `${s.update(n)}${s.final()}`;
        } catch (s) {
          let a = s instanceof RangeError, l = s.message === "Invalid key length", u = s.message === "Unsupported state or unable to authenticate data";
          if (a || l) {
            let c = new Error("INVALID_DOTENV_KEY: It must be 64 characters long (or more)");
            throw c.code = "INVALID_DOTENV_KEY", c;
          } else if (u) {
            let c = new Error("DECRYPTION_FAILED: Please check your DOTENV_KEY");
            throw c.code = "DECRYPTION_FAILED", c;
          } else throw s;
        }
      }
      function gp(e, r, t = {}) {
        let n = !!(t && t.debug), i = !!(t && t.override);
        if (typeof r != "object") {
          let o = new Error("OBJECT_REQUIRED: Please check the processEnv argument being passed to populate");
          throw o.code = "OBJECT_REQUIRED", o;
        }
        for (let o of Object.keys(r)) Object.prototype.hasOwnProperty.call(e, o) ? (i === true && (e[o] = r[o]), n && ot(i === true ? `"${o}" is already defined and WAS overwritten` : `"${o}" is already defined and was NOT overwritten`)) : e[o] = r[o];
      }
      var B = { configDotenv: dp, _configVault: pp, _parseVault: lp, config: mp, decrypt: fp, parse: ap, populate: gp };
      _e.exports.configDotenv = B.configDotenv;
      _e.exports._configVault = B._configVault;
      _e.exports._parseVault = B._parseVault;
      _e.exports.config = B.config;
      _e.exports.decrypt = B.decrypt;
      _e.exports.parse = B.parse;
      _e.exports.populate = B.populate;
      _e.exports = B;
    });
    var Os = ue((Kh, cn) => {
      "use strict";
      cn.exports = (e = {}) => {
        let r;
        if (e.repoUrl) r = e.repoUrl;
        else if (e.user && e.repo) r = `https://github.com/${e.user}/${e.repo}`;
        else throw new Error("You need to specify either the `repoUrl` option or both the `user` and `repo` options");
        let t = new URL(`${r}/issues/new`), n = ["body", "title", "labels", "template", "milestone", "assignee", "projects"];
        for (let i of n) {
          let o = e[i];
          if (o !== void 0) {
            if (i === "labels" || i === "projects") {
              if (!Array.isArray(o)) throw new TypeError(`The \`${i}\` option should be an array`);
              o = o.join(",");
            }
            t.searchParams.set(i, o);
          }
        }
        return t.toString();
      };
      cn.exports.default = cn.exports;
    });
    var Ki = ue((vb, ea) => {
      "use strict";
      ea.exports = /* @__PURE__ */ function() {
        function e(r, t, n, i, o) {
          return r < t || n < t ? r > n ? n + 1 : r + 1 : i === o ? t : t + 1;
        }
        return function(r, t) {
          if (r === t) return 0;
          if (r.length > t.length) {
            var n = r;
            r = t, t = n;
          }
          for (var i = r.length, o = t.length; i > 0 && r.charCodeAt(i - 1) === t.charCodeAt(o - 1); ) i--, o--;
          for (var s = 0; s < i && r.charCodeAt(s) === t.charCodeAt(s); ) s++;
          if (i -= s, o -= s, i === 0 || o < 3) return o;
          var a = 0, l, u, c, p, d, f, h, g, I, T, S, b, D = [];
          for (l = 0; l < i; l++) D.push(l + 1), D.push(r.charCodeAt(s + l));
          for (var me = D.length - 1; a < o - 3; ) for (I = t.charCodeAt(s + (u = a)), T = t.charCodeAt(s + (c = a + 1)), S = t.charCodeAt(s + (p = a + 2)), b = t.charCodeAt(s + (d = a + 3)), f = a += 4, l = 0; l < me; l += 2) h = D[l], g = D[l + 1], u = e(h, u, c, I, g), c = e(u, c, p, T, g), p = e(c, p, d, S, g), f = e(p, d, f, b, g), D[l] = f, d = p, p = c, c = u, u = h;
          for (; a < o; ) for (I = t.charCodeAt(s + (u = a)), f = ++a, l = 0; l < me; l += 2) h = D[l], D[l] = f = e(h, u, f, I, D[l + 1]), u = h;
          return f;
        };
      }();
    });
    var oa = Do(() => {
      "use strict";
    });
    var sa = Do(() => {
      "use strict";
    });
    var jf = {};
    tr(jf, { DMMF: () => ct, Debug: () => N, Decimal: () => Fe, Extensions: () => ni, MetricsClient: () => Lr, PrismaClientInitializationError: () => P, PrismaClientKnownRequestError: () => z2, PrismaClientRustPanicError: () => ae, PrismaClientUnknownRequestError: () => V, PrismaClientValidationError: () => Z, Public: () => ii, Sql: () => ie, createParam: () => va, defineDmmfProperty: () => Ca, deserializeJsonResponse: () => Vr, deserializeRawResult: () => Xn, dmmfToRuntimeDataModel: () => Ns, empty: () => Oa, getPrismaClient: () => fu, getRuntime: () => Kn, join: () => Da, makeStrictEnum: () => gu, makeTypedQueryFactory: () => Ia, objectEnumValues: () => On, raw: () => no, serializeJsonQuery: () => $n, skip: () => Mn, sqltag: () => io, warnEnvConflicts: () => hu, warnOnce: () => at });
    module2.exports = vu(jf);
    var ni = {};
    tr(ni, { defineExtension: () => ko, getExtensionContext: () => _o });
    function ko(e) {
      return typeof e == "function" ? e : (r) => r.$extends(e);
    }
    function _o(e) {
      return e;
    }
    var ii = {};
    tr(ii, { validator: () => No });
    function No(...e) {
      return (r) => r;
    }
    var Bt = {};
    tr(Bt, { $: () => qo, bgBlack: () => ku, bgBlue: () => Fu, bgCyan: () => $u, bgGreen: () => Nu, bgMagenta: () => Mu, bgRed: () => _u, bgWhite: () => qu, bgYellow: () => Lu, black: () => Cu, blue: () => nr, bold: () => W, cyan: () => De, dim: () => Ce, gray: () => Hr, green: () => qe, grey: () => Ou, hidden: () => Ru, inverse: () => Su, italic: () => Tu, magenta: () => Iu, red: () => ce, reset: () => Pu, strikethrough: () => Au, underline: () => Y, white: () => Du, yellow: () => Ie });
    var oi;
    var Lo;
    var Fo;
    var Mo;
    var $o = true;
    typeof process < "u" && ({ FORCE_COLOR: oi, NODE_DISABLE_COLORS: Lo, NO_COLOR: Fo, TERM: Mo } = process.env || {}, $o = process.stdout && process.stdout.isTTY);
    var qo = { enabled: !Lo && Fo == null && Mo !== "dumb" && (oi != null && oi !== "0" || $o) };
    function F(e, r) {
      let t = new RegExp(`\\x1b\\[${r}m`, "g"), n = `\x1B[${e}m`, i = `\x1B[${r}m`;
      return function(o) {
        return !qo.enabled || o == null ? o : n + (~("" + o).indexOf(i) ? o.replace(t, i + n) : o) + i;
      };
    }
    var Pu = F(0, 0);
    var W = F(1, 22);
    var Ce = F(2, 22);
    var Tu = F(3, 23);
    var Y = F(4, 24);
    var Su = F(7, 27);
    var Ru = F(8, 28);
    var Au = F(9, 29);
    var Cu = F(30, 39);
    var ce = F(31, 39);
    var qe = F(32, 39);
    var Ie = F(33, 39);
    var nr = F(34, 39);
    var Iu = F(35, 39);
    var De = F(36, 39);
    var Du = F(37, 39);
    var Hr = F(90, 39);
    var Ou = F(90, 39);
    var ku = F(40, 49);
    var _u = F(41, 49);
    var Nu = F(42, 49);
    var Lu = F(43, 49);
    var Fu = F(44, 49);
    var Mu = F(45, 49);
    var $u = F(46, 49);
    var qu = F(47, 49);
    var Vu = 100;
    var Vo = ["green", "yellow", "blue", "magenta", "cyan", "red"];
    var Yr = [];
    var jo = Date.now();
    var ju = 0;
    var si = typeof process < "u" ? process.env : {};
    globalThis.DEBUG ??= si.DEBUG ?? "";
    globalThis.DEBUG_COLORS ??= si.DEBUG_COLORS ? si.DEBUG_COLORS === "true" : true;
    var zr = { enable(e) {
      typeof e == "string" && (globalThis.DEBUG = e);
    }, disable() {
      let e = globalThis.DEBUG;
      return globalThis.DEBUG = "", e;
    }, enabled(e) {
      let r = globalThis.DEBUG.split(",").map((i) => i.replace(/[.+?^${}()|[\]\\]/g, "\\$&")), t = r.some((i) => i === "" || i[0] === "-" ? false : e.match(RegExp(i.split("*").join(".*") + "$"))), n = r.some((i) => i === "" || i[0] !== "-" ? false : e.match(RegExp(i.slice(1).split("*").join(".*") + "$")));
      return t && !n;
    }, log: (...e) => {
      let [r, t, ...n] = e;
      (console.warn ?? console.log)(`${r} ${t}`, ...n);
    }, formatters: {} };
    function Bu(e) {
      let r = { color: Vo[ju++ % Vo.length], enabled: zr.enabled(e), namespace: e, log: zr.log, extend: () => {
      } }, t = (...n) => {
        let { enabled: i, namespace: o, color: s, log: a } = r;
        if (n.length !== 0 && Yr.push([o, ...n]), Yr.length > Vu && Yr.shift(), zr.enabled(o) || i) {
          let l = n.map((c) => typeof c == "string" ? c : Uu(c)), u = `+${Date.now() - jo}ms`;
          jo = Date.now(), globalThis.DEBUG_COLORS ? a(Bt[s](W(o)), ...l, Bt[s](u)) : a(o, ...l, u);
        }
      };
      return new Proxy(t, { get: (n, i) => r[i], set: (n, i, o) => r[i] = o });
    }
    var N = new Proxy(Bu, { get: (e, r) => zr[r], set: (e, r, t) => zr[r] = t });
    function Uu(e, r = 2) {
      let t = /* @__PURE__ */ new Set();
      return JSON.stringify(e, (n, i) => {
        if (typeof i == "object" && i !== null) {
          if (t.has(i)) return "[Circular *]";
          t.add(i);
        } else if (typeof i == "bigint") return i.toString();
        return i;
      }, r);
    }
    function Bo(e = 7500) {
      let r = Yr.map(([t, ...n]) => `${t} ${n.map((i) => typeof i == "string" ? i : JSON.stringify(i)).join(" ")}`).join(`
`);
      return r.length < e ? r : r.slice(-e);
    }
    function Uo() {
      Yr.length = 0;
    }
    var gr = N;
    var Go = O(require("node:fs"));
    function ai() {
      let e = process.env.PRISMA_QUERY_ENGINE_LIBRARY;
      if (!(e && Go.default.existsSync(e)) && process.arch === "ia32") throw new Error('The default query engine type (Node-API, "library") is currently not supported for 32bit Node. Please set `engineType = "binary"` in the "generator" block of your "schema.prisma" file (or use the environment variables "PRISMA_CLIENT_ENGINE_TYPE=binary" and/or "PRISMA_CLI_QUERY_ENGINE_TYPE=binary".)');
    }
    var li = ["darwin", "darwin-arm64", "debian-openssl-1.0.x", "debian-openssl-1.1.x", "debian-openssl-3.0.x", "rhel-openssl-1.0.x", "rhel-openssl-1.1.x", "rhel-openssl-3.0.x", "linux-arm64-openssl-1.1.x", "linux-arm64-openssl-1.0.x", "linux-arm64-openssl-3.0.x", "linux-arm-openssl-1.1.x", "linux-arm-openssl-1.0.x", "linux-arm-openssl-3.0.x", "linux-musl", "linux-musl-openssl-3.0.x", "linux-musl-arm64-openssl-1.1.x", "linux-musl-arm64-openssl-3.0.x", "linux-nixos", "linux-static-x64", "linux-static-arm64", "windows", "freebsd11", "freebsd12", "freebsd13", "freebsd14", "freebsd15", "openbsd", "netbsd", "arm"];
    var Ut = "libquery_engine";
    function Gt(e, r) {
      let t = r === "url";
      return e.includes("windows") ? t ? "query_engine.dll.node" : `query_engine-${e}.dll.node` : e.includes("darwin") ? t ? `${Ut}.dylib.node` : `${Ut}-${e}.dylib.node` : t ? `${Ut}.so.node` : `${Ut}-${e}.so.node`;
    }
    var Ko = O(require("node:child_process"));
    var mi = O(require("node:fs/promises"));
    var Ht = O(require("node:os"));
    var Oe = Symbol.for("@ts-pattern/matcher");
    var Gu = Symbol.for("@ts-pattern/isVariadic");
    var Wt = "@ts-pattern/anonymous-select-key";
    var ui = (e) => !!(e && typeof e == "object");
    var Qt = (e) => e && !!e[Oe];
    var Ee = (e, r, t) => {
      if (Qt(e)) {
        let n = e[Oe](), { matched: i, selections: o } = n.match(r);
        return i && o && Object.keys(o).forEach((s) => t(s, o[s])), i;
      }
      if (ui(e)) {
        if (!ui(r)) return false;
        if (Array.isArray(e)) {
          if (!Array.isArray(r)) return false;
          let n = [], i = [], o = [];
          for (let s of e.keys()) {
            let a = e[s];
            Qt(a) && a[Gu] ? o.push(a) : o.length ? i.push(a) : n.push(a);
          }
          if (o.length) {
            if (o.length > 1) throw new Error("Pattern error: Using `...P.array(...)` several times in a single pattern is not allowed.");
            if (r.length < n.length + i.length) return false;
            let s = r.slice(0, n.length), a = i.length === 0 ? [] : r.slice(-i.length), l = r.slice(n.length, i.length === 0 ? 1 / 0 : -i.length);
            return n.every((u, c) => Ee(u, s[c], t)) && i.every((u, c) => Ee(u, a[c], t)) && (o.length === 0 || Ee(o[0], l, t));
          }
          return e.length === r.length && e.every((s, a) => Ee(s, r[a], t));
        }
        return Reflect.ownKeys(e).every((n) => {
          let i = e[n];
          return (n in r || Qt(o = i) && o[Oe]().matcherType === "optional") && Ee(i, r[n], t);
          var o;
        });
      }
      return Object.is(r, e);
    };
    var Ge = (e) => {
      var r, t, n;
      return ui(e) ? Qt(e) ? (r = (t = (n = e[Oe]()).getSelectionKeys) == null ? void 0 : t.call(n)) != null ? r : [] : Array.isArray(e) ? Zr(e, Ge) : Zr(Object.values(e), Ge) : [];
    };
    var Zr = (e, r) => e.reduce((t, n) => t.concat(r(n)), []);
    function pe(e) {
      return Object.assign(e, { optional: () => Qu(e), and: (r) => q(e, r), or: (r) => Wu(e, r), select: (r) => r === void 0 ? Qo(e) : Qo(r, e) });
    }
    function Qu(e) {
      return pe({ [Oe]: () => ({ match: (r) => {
        let t = {}, n = (i, o) => {
          t[i] = o;
        };
        return r === void 0 ? (Ge(e).forEach((i) => n(i, void 0)), { matched: true, selections: t }) : { matched: Ee(e, r, n), selections: t };
      }, getSelectionKeys: () => Ge(e), matcherType: "optional" }) });
    }
    function q(...e) {
      return pe({ [Oe]: () => ({ match: (r) => {
        let t = {}, n = (i, o) => {
          t[i] = o;
        };
        return { matched: e.every((i) => Ee(i, r, n)), selections: t };
      }, getSelectionKeys: () => Zr(e, Ge), matcherType: "and" }) });
    }
    function Wu(...e) {
      return pe({ [Oe]: () => ({ match: (r) => {
        let t = {}, n = (i, o) => {
          t[i] = o;
        };
        return Zr(e, Ge).forEach((i) => n(i, void 0)), { matched: e.some((i) => Ee(i, r, n)), selections: t };
      }, getSelectionKeys: () => Zr(e, Ge), matcherType: "or" }) });
    }
    function A(e) {
      return { [Oe]: () => ({ match: (r) => ({ matched: !!e(r) }) }) };
    }
    function Qo(...e) {
      let r = typeof e[0] == "string" ? e[0] : void 0, t = e.length === 2 ? e[1] : typeof e[0] == "string" ? void 0 : e[0];
      return pe({ [Oe]: () => ({ match: (n) => {
        let i = { [r ?? Wt]: n };
        return { matched: t === void 0 || Ee(t, n, (o, s) => {
          i[o] = s;
        }), selections: i };
      }, getSelectionKeys: () => [r ?? Wt].concat(t === void 0 ? [] : Ge(t)) }) });
    }
    function ye(e) {
      return typeof e == "number";
    }
    function Ve(e) {
      return typeof e == "string";
    }
    function je(e) {
      return typeof e == "bigint";
    }
    var eg = pe(A(function(e) {
      return true;
    }));
    var Be = (e) => Object.assign(pe(e), { startsWith: (r) => {
      return Be(q(e, (t = r, A((n) => Ve(n) && n.startsWith(t)))));
      var t;
    }, endsWith: (r) => {
      return Be(q(e, (t = r, A((n) => Ve(n) && n.endsWith(t)))));
      var t;
    }, minLength: (r) => Be(q(e, ((t) => A((n) => Ve(n) && n.length >= t))(r))), length: (r) => Be(q(e, ((t) => A((n) => Ve(n) && n.length === t))(r))), maxLength: (r) => Be(q(e, ((t) => A((n) => Ve(n) && n.length <= t))(r))), includes: (r) => {
      return Be(q(e, (t = r, A((n) => Ve(n) && n.includes(t)))));
      var t;
    }, regex: (r) => {
      return Be(q(e, (t = r, A((n) => Ve(n) && !!n.match(t)))));
      var t;
    } });
    var rg = Be(A(Ve));
    var be = (e) => Object.assign(pe(e), { between: (r, t) => be(q(e, ((n, i) => A((o) => ye(o) && n <= o && i >= o))(r, t))), lt: (r) => be(q(e, ((t) => A((n) => ye(n) && n < t))(r))), gt: (r) => be(q(e, ((t) => A((n) => ye(n) && n > t))(r))), lte: (r) => be(q(e, ((t) => A((n) => ye(n) && n <= t))(r))), gte: (r) => be(q(e, ((t) => A((n) => ye(n) && n >= t))(r))), int: () => be(q(e, A((r) => ye(r) && Number.isInteger(r)))), finite: () => be(q(e, A((r) => ye(r) && Number.isFinite(r)))), positive: () => be(q(e, A((r) => ye(r) && r > 0))), negative: () => be(q(e, A((r) => ye(r) && r < 0))) });
    var tg = be(A(ye));
    var Ue = (e) => Object.assign(pe(e), { between: (r, t) => Ue(q(e, ((n, i) => A((o) => je(o) && n <= o && i >= o))(r, t))), lt: (r) => Ue(q(e, ((t) => A((n) => je(n) && n < t))(r))), gt: (r) => Ue(q(e, ((t) => A((n) => je(n) && n > t))(r))), lte: (r) => Ue(q(e, ((t) => A((n) => je(n) && n <= t))(r))), gte: (r) => Ue(q(e, ((t) => A((n) => je(n) && n >= t))(r))), positive: () => Ue(q(e, A((r) => je(r) && r > 0))), negative: () => Ue(q(e, A((r) => je(r) && r < 0))) });
    var ng = Ue(A(je));
    var ig = pe(A(function(e) {
      return typeof e == "boolean";
    }));
    var og = pe(A(function(e) {
      return typeof e == "symbol";
    }));
    var sg = pe(A(function(e) {
      return e == null;
    }));
    var ag = pe(A(function(e) {
      return e != null;
    }));
    var ci = class extends Error {
      constructor(r) {
        let t;
        try {
          t = JSON.stringify(r);
        } catch {
          t = r;
        }
        super(`Pattern matching error: no pattern matches value ${t}`), this.input = void 0, this.input = r;
      }
    };
    var pi = { matched: false, value: void 0 };
    function hr(e) {
      return new di(e, pi);
    }
    var di = class e {
      constructor(r, t) {
        this.input = void 0, this.state = void 0, this.input = r, this.state = t;
      }
      with(...r) {
        if (this.state.matched) return this;
        let t = r[r.length - 1], n = [r[0]], i;
        r.length === 3 && typeof r[1] == "function" ? i = r[1] : r.length > 2 && n.push(...r.slice(1, r.length - 1));
        let o = false, s = {}, a = (u, c) => {
          o = true, s[u] = c;
        }, l = !n.some((u) => Ee(u, this.input, a)) || i && !i(this.input) ? pi : { matched: true, value: t(o ? Wt in s ? s[Wt] : s : this.input, this.input) };
        return new e(this.input, l);
      }
      when(r, t) {
        if (this.state.matched) return this;
        let n = !!r(this.input);
        return new e(this.input, n ? { matched: true, value: t(this.input, this.input) } : pi);
      }
      otherwise(r) {
        return this.state.matched ? this.state.value : r(this.input);
      }
      exhaustive() {
        if (this.state.matched) return this.state.value;
        throw new ci(this.input);
      }
      run() {
        return this.exhaustive();
      }
      returnType() {
        return this;
      }
    };
    var Ho = require("node:util");
    var Ju = { warn: Ie("prisma:warn") };
    var Ku = { warn: () => !process.env.PRISMA_DISABLE_WARNINGS };
    function Jt(e, ...r) {
      Ku.warn() && console.warn(`${Ju.warn} ${e}`, ...r);
    }
    var Hu = (0, Ho.promisify)(Ko.default.exec);
    var ee = gr("prisma:get-platform");
    var Yu = ["1.0.x", "1.1.x", "3.0.x"];
    async function Yo() {
      let e = Ht.default.platform(), r = process.arch;
      if (e === "freebsd") {
        let s = await Yt("freebsd-version");
        if (s && s.trim().length > 0) {
          let l = /^(\d+)\.?/.exec(s);
          if (l) return { platform: "freebsd", targetDistro: `freebsd${l[1]}`, arch: r };
        }
      }
      if (e !== "linux") return { platform: e, arch: r };
      let t = await Zu(), n = await sc(), i = ec({ arch: r, archFromUname: n, familyDistro: t.familyDistro }), { libssl: o } = await rc(i);
      return { platform: "linux", libssl: o, arch: r, archFromUname: n, ...t };
    }
    function zu(e) {
      let r = /^ID="?([^"\n]*)"?$/im, t = /^ID_LIKE="?([^"\n]*)"?$/im, n = r.exec(e), i = n && n[1] && n[1].toLowerCase() || "", o = t.exec(e), s = o && o[1] && o[1].toLowerCase() || "", a = hr({ id: i, idLike: s }).with({ id: "alpine" }, ({ id: l }) => ({ targetDistro: "musl", familyDistro: l, originalDistro: l })).with({ id: "raspbian" }, ({ id: l }) => ({ targetDistro: "arm", familyDistro: "debian", originalDistro: l })).with({ id: "nixos" }, ({ id: l }) => ({ targetDistro: "nixos", originalDistro: l, familyDistro: "nixos" })).with({ id: "debian" }, { id: "ubuntu" }, ({ id: l }) => ({ targetDistro: "debian", familyDistro: "debian", originalDistro: l })).with({ id: "rhel" }, { id: "centos" }, { id: "fedora" }, ({ id: l }) => ({ targetDistro: "rhel", familyDistro: "rhel", originalDistro: l })).when(({ idLike: l }) => l.includes("debian") || l.includes("ubuntu"), ({ id: l }) => ({ targetDistro: "debian", familyDistro: "debian", originalDistro: l })).when(({ idLike: l }) => i === "arch" || l.includes("arch"), ({ id: l }) => ({ targetDistro: "debian", familyDistro: "arch", originalDistro: l })).when(({ idLike: l }) => l.includes("centos") || l.includes("fedora") || l.includes("rhel") || l.includes("suse"), ({ id: l }) => ({ targetDistro: "rhel", familyDistro: "rhel", originalDistro: l })).otherwise(({ id: l }) => ({ targetDistro: void 0, familyDistro: void 0, originalDistro: l }));
      return ee(`Found distro info:
${JSON.stringify(a, null, 2)}`), a;
    }
    async function Zu() {
      let e = "/etc/os-release";
      try {
        let r = await mi.default.readFile(e, { encoding: "utf-8" });
        return zu(r);
      } catch {
        return { targetDistro: void 0, familyDistro: void 0, originalDistro: void 0 };
      }
    }
    function Xu(e) {
      let r = /^OpenSSL\s(\d+\.\d+)\.\d+/.exec(e);
      if (r) {
        let t = `${r[1]}.x`;
        return zo(t);
      }
    }
    function Wo(e) {
      let r = /libssl\.so\.(\d)(\.\d)?/.exec(e);
      if (r) {
        let t = `${r[1]}${r[2] ?? ".0"}.x`;
        return zo(t);
      }
    }
    function zo(e) {
      let r = (() => {
        if (Xo(e)) return e;
        let t = e.split(".");
        return t[1] = "0", t.join(".");
      })();
      if (Yu.includes(r)) return r;
    }
    function ec(e) {
      return hr(e).with({ familyDistro: "musl" }, () => (ee('Trying platform-specific paths for "alpine"'), ["/lib", "/usr/lib"])).with({ familyDistro: "debian" }, ({ archFromUname: r }) => (ee('Trying platform-specific paths for "debian" (and "ubuntu")'), [`/usr/lib/${r}-linux-gnu`, `/lib/${r}-linux-gnu`])).with({ familyDistro: "rhel" }, () => (ee('Trying platform-specific paths for "rhel"'), ["/lib64", "/usr/lib64"])).otherwise(({ familyDistro: r, arch: t, archFromUname: n }) => (ee(`Don't know any platform-specific paths for "${r}" on ${t} (${n})`), []));
    }
    async function rc(e) {
      let r = 'grep -v "libssl.so.0"', t = await Jo(e);
      if (t) {
        ee(`Found libssl.so file using platform-specific paths: ${t}`);
        let o = Wo(t);
        if (ee(`The parsed libssl version is: ${o}`), o) return { libssl: o, strategy: "libssl-specific-path" };
      }
      ee('Falling back to "ldconfig" and other generic paths');
      let n = await Yt(`ldconfig -p | sed "s/.*=>s*//" | sed "s|.*/||" | grep libssl | sort | ${r}`);
      if (n || (n = await Jo(["/lib64", "/usr/lib64", "/lib", "/usr/lib"])), n) {
        ee(`Found libssl.so file using "ldconfig" or other generic paths: ${n}`);
        let o = Wo(n);
        if (ee(`The parsed libssl version is: ${o}`), o) return { libssl: o, strategy: "ldconfig" };
      }
      let i = await Yt("openssl version -v");
      if (i) {
        ee(`Found openssl binary with version: ${i}`);
        let o = Xu(i);
        if (ee(`The parsed openssl version is: ${o}`), o) return { libssl: o, strategy: "openssl-binary" };
      }
      return ee("Couldn't find any version of libssl or OpenSSL in the system"), {};
    }
    async function Jo(e) {
      for (let r of e) {
        let t = await tc(r);
        if (t) return t;
      }
    }
    async function tc(e) {
      try {
        return (await mi.default.readdir(e)).find((t) => t.startsWith("libssl.so.") && !t.startsWith("libssl.so.0"));
      } catch (r) {
        if (r.code === "ENOENT") return;
        throw r;
      }
    }
    async function ir() {
      let { binaryTarget: e } = await Zo();
      return e;
    }
    function nc(e) {
      return e.binaryTarget !== void 0;
    }
    async function fi() {
      let { memoized: e, ...r } = await Zo();
      return r;
    }
    var Kt = {};
    async function Zo() {
      if (nc(Kt)) return Promise.resolve({ ...Kt, memoized: true });
      let e = await Yo(), r = ic(e);
      return Kt = { ...e, binaryTarget: r }, { ...Kt, memoized: false };
    }
    function ic(e) {
      let { platform: r, arch: t, archFromUname: n, libssl: i, targetDistro: o, familyDistro: s, originalDistro: a } = e;
      r === "linux" && !["x64", "arm64"].includes(t) && Jt(`Prisma only officially supports Linux on amd64 (x86_64) and arm64 (aarch64) system architectures (detected "${t}" instead). If you are using your own custom Prisma engines, you can ignore this warning, as long as you've compiled the engines for your system architecture "${n}".`);
      let l = "1.1.x";
      if (r === "linux" && i === void 0) {
        let c = hr({ familyDistro: s }).with({ familyDistro: "debian" }, () => "Please manually install OpenSSL via `apt-get update -y && apt-get install -y openssl` and try installing Prisma again. If you're running Prisma on Docker, add this command to your Dockerfile, or switch to an image that already has OpenSSL installed.").otherwise(() => "Please manually install OpenSSL and try installing Prisma again.");
        Jt(`Prisma failed to detect the libssl/openssl version to use, and may not work as expected. Defaulting to "openssl-${l}".
${c}`);
      }
      let u = "debian";
      if (r === "linux" && o === void 0 && ee(`Distro is "${a}". Falling back to Prisma engines built for "${u}".`), r === "darwin" && t === "arm64") return "darwin-arm64";
      if (r === "darwin") return "darwin";
      if (r === "win32") return "windows";
      if (r === "freebsd") return o;
      if (r === "openbsd") return "openbsd";
      if (r === "netbsd") return "netbsd";
      if (r === "linux" && o === "nixos") return "linux-nixos";
      if (r === "linux" && t === "arm64") return `${o === "musl" ? "linux-musl-arm64" : "linux-arm64"}-openssl-${i || l}`;
      if (r === "linux" && t === "arm") return `linux-arm-openssl-${i || l}`;
      if (r === "linux" && o === "musl") {
        let c = "linux-musl";
        return !i || Xo(i) ? c : `${c}-openssl-${i}`;
      }
      return r === "linux" && o && i ? `${o}-openssl-${i}` : (r !== "linux" && Jt(`Prisma detected unknown OS "${r}" and may not work as expected. Defaulting to "linux".`), i ? `${u}-openssl-${i}` : o ? `${o}-openssl-${l}` : `${u}-openssl-${l}`);
    }
    async function oc(e) {
      try {
        return await e();
      } catch {
        return;
      }
    }
    function Yt(e) {
      return oc(async () => {
        let r = await Hu(e);
        return ee(`Command "${e}" successfully returned "${r.stdout}"`), r.stdout;
      });
    }
    async function sc() {
      return typeof Ht.default.machine == "function" ? Ht.default.machine() : (await Yt("uname -m"))?.trim();
    }
    function Xo(e) {
      return e.startsWith("1.");
    }
    var Xt = {};
    tr(Xt, { beep: () => kc, clearScreen: () => Cc, clearTerminal: () => Ic, cursorBackward: () => mc, cursorDown: () => pc, cursorForward: () => dc, cursorGetPosition: () => hc, cursorHide: () => Ec, cursorLeft: () => ts, cursorMove: () => cc, cursorNextLine: () => yc, cursorPrevLine: () => bc, cursorRestorePosition: () => gc, cursorSavePosition: () => fc, cursorShow: () => wc, cursorTo: () => uc, cursorUp: () => rs, enterAlternativeScreen: () => Dc, eraseDown: () => Tc, eraseEndLine: () => vc, eraseLine: () => ns, eraseLines: () => xc, eraseScreen: () => gi, eraseStartLine: () => Pc, eraseUp: () => Sc, exitAlternativeScreen: () => Oc, iTerm: () => Lc, image: () => Nc, link: () => _c, scrollDown: () => Ac, scrollUp: () => Rc });
    var Zt = O(require("node:process"), 1);
    var zt = globalThis.window?.document !== void 0;
    var gg = globalThis.process?.versions?.node !== void 0;
    var hg = globalThis.process?.versions?.bun !== void 0;
    var yg = globalThis.Deno?.version?.deno !== void 0;
    var bg = globalThis.process?.versions?.electron !== void 0;
    var Eg = globalThis.navigator?.userAgent?.includes("jsdom") === true;
    var wg = typeof WorkerGlobalScope < "u" && globalThis instanceof WorkerGlobalScope;
    var xg = typeof DedicatedWorkerGlobalScope < "u" && globalThis instanceof DedicatedWorkerGlobalScope;
    var vg = typeof SharedWorkerGlobalScope < "u" && globalThis instanceof SharedWorkerGlobalScope;
    var Pg = typeof ServiceWorkerGlobalScope < "u" && globalThis instanceof ServiceWorkerGlobalScope;
    var Xr = globalThis.navigator?.userAgentData?.platform;
    var Tg = Xr === "macOS" || globalThis.navigator?.platform === "MacIntel" || globalThis.navigator?.userAgent?.includes(" Mac ") === true || globalThis.process?.platform === "darwin";
    var Sg = Xr === "Windows" || globalThis.navigator?.platform === "Win32" || globalThis.process?.platform === "win32";
    var Rg = Xr === "Linux" || globalThis.navigator?.platform?.startsWith("Linux") === true || globalThis.navigator?.userAgent?.includes(" Linux ") === true || globalThis.process?.platform === "linux";
    var Ag = Xr === "iOS" || globalThis.navigator?.platform === "MacIntel" && globalThis.navigator?.maxTouchPoints > 1 || /iPad|iPhone|iPod/.test(globalThis.navigator?.platform);
    var Cg = Xr === "Android" || globalThis.navigator?.platform === "Android" || globalThis.navigator?.userAgent?.includes(" Android ") === true || globalThis.process?.platform === "android";
    var C = "\x1B[";
    var rt = "\x1B]";
    var yr = "\x07";
    var et = ";";
    var es = !zt && Zt.default.env.TERM_PROGRAM === "Apple_Terminal";
    var ac = !zt && Zt.default.platform === "win32";
    var lc = zt ? () => {
      throw new Error("`process.cwd()` only works in Node.js, not the browser.");
    } : Zt.default.cwd;
    var uc = (e, r) => {
      if (typeof e != "number") throw new TypeError("The `x` argument is required");
      return typeof r != "number" ? C + (e + 1) + "G" : C + (r + 1) + et + (e + 1) + "H";
    };
    var cc = (e, r) => {
      if (typeof e != "number") throw new TypeError("The `x` argument is required");
      let t = "";
      return e < 0 ? t += C + -e + "D" : e > 0 && (t += C + e + "C"), r < 0 ? t += C + -r + "A" : r > 0 && (t += C + r + "B"), t;
    };
    var rs = (e = 1) => C + e + "A";
    var pc = (e = 1) => C + e + "B";
    var dc = (e = 1) => C + e + "C";
    var mc = (e = 1) => C + e + "D";
    var ts = C + "G";
    var fc = es ? "\x1B7" : C + "s";
    var gc = es ? "\x1B8" : C + "u";
    var hc = C + "6n";
    var yc = C + "E";
    var bc = C + "F";
    var Ec = C + "?25l";
    var wc = C + "?25h";
    var xc = (e) => {
      let r = "";
      for (let t = 0; t < e; t++) r += ns + (t < e - 1 ? rs() : "");
      return e && (r += ts), r;
    };
    var vc = C + "K";
    var Pc = C + "1K";
    var ns = C + "2K";
    var Tc = C + "J";
    var Sc = C + "1J";
    var gi = C + "2J";
    var Rc = C + "S";
    var Ac = C + "T";
    var Cc = "\x1Bc";
    var Ic = ac ? `${gi}${C}0f` : `${gi}${C}3J${C}H`;
    var Dc = C + "?1049h";
    var Oc = C + "?1049l";
    var kc = yr;
    var _c = (e, r) => [rt, "8", et, et, r, yr, e, rt, "8", et, et, yr].join("");
    var Nc = (e, r = {}) => {
      let t = `${rt}1337;File=inline=1`;
      return r.width && (t += `;width=${r.width}`), r.height && (t += `;height=${r.height}`), r.preserveAspectRatio === false && (t += ";preserveAspectRatio=0"), t + ":" + Buffer.from(e).toString("base64") + yr;
    };
    var Lc = { setCwd: (e = lc()) => `${rt}50;CurrentDir=${e}${yr}`, annotation(e, r = {}) {
      let t = `${rt}1337;`, n = r.x !== void 0, i = r.y !== void 0;
      if ((n || i) && !(n && i && r.length !== void 0)) throw new Error("`x`, `y` and `length` must be defined when `x` or `y` is defined");
      return e = e.replaceAll("|", ""), t += r.isHidden ? "AddHiddenAnnotation=" : "AddAnnotation=", r.length > 0 ? t += (n ? [e, r.length, r.x, r.y] : [r.length, e]).join("|") : t += e, t + yr;
    } };
    var en = O(cs(), 1);
    function or(e, r, { target: t = "stdout", ...n } = {}) {
      return en.default[t] ? Xt.link(e, r) : n.fallback === false ? e : typeof n.fallback == "function" ? n.fallback(e, r) : `${e} (\u200B${r}\u200B)`;
    }
    or.isSupported = en.default.stdout;
    or.stderr = (e, r, t = {}) => or(e, r, { target: "stderr", ...t });
    or.stderr.isSupported = en.default.stderr;
    function wi(e) {
      return or(e, e, { fallback: Y });
    }
    var Vc = ps();
    var xi = Vc.version;
    function Er(e) {
      let r = jc();
      return r || (e?.config.engineType === "library" ? "library" : e?.config.engineType === "binary" ? "binary" : e?.config.engineType === "client" ? "client" : Bc());
    }
    function jc() {
      let e = process.env.PRISMA_CLIENT_ENGINE_TYPE;
      return e === "library" ? "library" : e === "binary" ? "binary" : e === "client" ? "client" : void 0;
    }
    function Bc() {
      return "library";
    }
    function vi(e) {
      return e.name === "DriverAdapterError" && typeof e.cause == "object";
    }
    function rn(e) {
      return { ok: true, value: e, map(r) {
        return rn(r(e));
      }, flatMap(r) {
        return r(e);
      } };
    }
    function sr(e) {
      return { ok: false, error: e, map() {
        return sr(e);
      }, flatMap() {
        return sr(e);
      } };
    }
    var ds = N("driver-adapter-utils");
    var Pi = class {
      registeredErrors = [];
      consumeError(r) {
        return this.registeredErrors[r];
      }
      registerNewError(r) {
        let t = 0;
        for (; this.registeredErrors[t] !== void 0; ) t++;
        return this.registeredErrors[t] = { error: r }, t;
      }
    };
    var tn = (e, r = new Pi()) => {
      let t = { adapterName: e.adapterName, errorRegistry: r, queryRaw: ke(r, e.queryRaw.bind(e)), executeRaw: ke(r, e.executeRaw.bind(e)), executeScript: ke(r, e.executeScript.bind(e)), dispose: ke(r, e.dispose.bind(e)), provider: e.provider, startTransaction: async (...n) => (await ke(r, e.startTransaction.bind(e))(...n)).map((o) => Uc(r, o)) };
      return e.getConnectionInfo && (t.getConnectionInfo = Gc(r, e.getConnectionInfo.bind(e))), t;
    };
    var Uc = (e, r) => ({ adapterName: r.adapterName, provider: r.provider, options: r.options, queryRaw: ke(e, r.queryRaw.bind(r)), executeRaw: ke(e, r.executeRaw.bind(r)), commit: ke(e, r.commit.bind(r)), rollback: ke(e, r.rollback.bind(r)) });
    function ke(e, r) {
      return async (...t) => {
        try {
          return rn(await r(...t));
        } catch (n) {
          if (ds("[error@wrapAsync]", n), vi(n)) return sr(n.cause);
          let i = e.registerNewError(n);
          return sr({ kind: "GenericJs", id: i });
        }
      };
    }
    function Gc(e, r) {
      return (...t) => {
        try {
          return rn(r(...t));
        } catch (n) {
          if (ds("[error@wrapSync]", n), vi(n)) return sr(n.cause);
          let i = e.registerNewError(n);
          return sr({ kind: "GenericJs", id: i });
        }
      };
    }
    var Wc = O(on());
    var M = O(require("node:path"));
    var Jc = O(on());
    var wh = N("prisma:engines");
    function ms() {
      return M.default.join(__dirname, "../");
    }
    M.default.join(__dirname, "../query-engine-darwin");
    M.default.join(__dirname, "../query-engine-darwin-arm64");
    M.default.join(__dirname, "../query-engine-debian-openssl-1.0.x");
    M.default.join(__dirname, "../query-engine-debian-openssl-1.1.x");
    M.default.join(__dirname, "../query-engine-debian-openssl-3.0.x");
    M.default.join(__dirname, "../query-engine-linux-static-x64");
    M.default.join(__dirname, "../query-engine-linux-static-arm64");
    M.default.join(__dirname, "../query-engine-rhel-openssl-1.0.x");
    M.default.join(__dirname, "../query-engine-rhel-openssl-1.1.x");
    M.default.join(__dirname, "../query-engine-rhel-openssl-3.0.x");
    M.default.join(__dirname, "../libquery_engine-darwin.dylib.node");
    M.default.join(__dirname, "../libquery_engine-darwin-arm64.dylib.node");
    M.default.join(__dirname, "../libquery_engine-debian-openssl-1.0.x.so.node");
    M.default.join(__dirname, "../libquery_engine-debian-openssl-1.1.x.so.node");
    M.default.join(__dirname, "../libquery_engine-debian-openssl-3.0.x.so.node");
    M.default.join(__dirname, "../libquery_engine-linux-arm64-openssl-1.0.x.so.node");
    M.default.join(__dirname, "../libquery_engine-linux-arm64-openssl-1.1.x.so.node");
    M.default.join(__dirname, "../libquery_engine-linux-arm64-openssl-3.0.x.so.node");
    M.default.join(__dirname, "../libquery_engine-linux-musl.so.node");
    M.default.join(__dirname, "../libquery_engine-linux-musl-openssl-3.0.x.so.node");
    M.default.join(__dirname, "../libquery_engine-rhel-openssl-1.0.x.so.node");
    M.default.join(__dirname, "../libquery_engine-rhel-openssl-1.1.x.so.node");
    M.default.join(__dirname, "../libquery_engine-rhel-openssl-3.0.x.so.node");
    M.default.join(__dirname, "../query_engine-windows.dll.node");
    var Si = O(require("node:fs"));
    var fs = gr("chmodPlusX");
    function Ri(e) {
      if (process.platform === "win32") return;
      let r = Si.default.statSync(e), t = r.mode | 64 | 8 | 1;
      if (r.mode === t) {
        fs(`Execution permissions of ${e} are fine`);
        return;
      }
      let n = t.toString(8).slice(-3);
      fs(`Have to call chmodPlusX on ${e}`), Si.default.chmodSync(e, n);
    }
    function Ai(e) {
      let r = e.e, t = (a) => `Prisma cannot find the required \`${a}\` system library in your system`, n = r.message.includes("cannot open shared object file"), i = `Please refer to the documentation about Prisma's system requirements: ${wi("https://pris.ly/d/system-requirements")}`, o = `Unable to require(\`${Ce(e.id)}\`).`, s = hr({ message: r.message, code: r.code }).with({ code: "ENOENT" }, () => "File does not exist.").when(({ message: a }) => n && a.includes("libz"), () => `${t("libz")}. Please install it and try again.`).when(({ message: a }) => n && a.includes("libgcc_s"), () => `${t("libgcc_s")}. Please install it and try again.`).when(({ message: a }) => n && a.includes("libssl"), () => {
        let a = e.platformInfo.libssl ? `openssl-${e.platformInfo.libssl}` : "openssl";
        return `${t("libssl")}. Please install ${a} and try again.`;
      }).when(({ message: a }) => a.includes("GLIBC"), () => `Prisma has detected an incompatible version of the \`glibc\` C standard library installed in your system. This probably means your system may be too old to run Prisma. ${i}`).when(({ message: a }) => e.platformInfo.platform === "linux" && a.includes("symbol not found"), () => `The Prisma engines are not compatible with your system ${e.platformInfo.originalDistro} on (${e.platformInfo.archFromUname}) which uses the \`${e.platformInfo.binaryTarget}\` binaryTarget by default. ${i}`).otherwise(() => `The Prisma engines do not seem to be compatible with your system. ${i}`);
      return `${o}
${s}

Details: ${r.message}`;
    }
    var ys = O(hs(), 1);
    function Ci(e) {
      let r = (0, ys.default)(e);
      if (r === 0) return e;
      let t = new RegExp(`^[ \\t]{${r}}`, "gm");
      return e.replace(t, "");
    }
    var bs = "prisma+postgres";
    var sn = `${bs}:`;
    function an(e) {
      return e?.toString().startsWith(`${sn}//`) ?? false;
    }
    function Ii(e) {
      if (!an(e)) return false;
      let { host: r } = new URL(e);
      return r.includes("localhost") || r.includes("127.0.0.1") || r.includes("[::1]");
    }
    var ws = O(Di());
    function ki(e) {
      return String(new Oi(e));
    }
    var Oi = class {
      constructor(r) {
        this.config = r;
      }
      toString() {
        let { config: r } = this, t = r.provider.fromEnvVar ? `env("${r.provider.fromEnvVar}")` : r.provider.value, n = JSON.parse(JSON.stringify({ provider: t, binaryTargets: Kc(r.binaryTargets) }));
        return `generator ${r.name} {
${(0, ws.default)(Hc(n), 2)}
}`;
      }
    };
    function Kc(e) {
      let r;
      if (e.length > 0) {
        let t = e.find((n) => n.fromEnvVar !== null);
        t ? r = `env("${t.fromEnvVar}")` : r = e.map((n) => n.native ? "native" : n.value);
      } else r = void 0;
      return r;
    }
    function Hc(e) {
      let r = Object.keys(e).reduce((t, n) => Math.max(t, n.length), 0);
      return Object.entries(e).map(([t, n]) => `${t.padEnd(r)} = ${Yc(n)}`).join(`
`);
    }
    function Yc(e) {
      return JSON.parse(JSON.stringify(e, (r, t) => Array.isArray(t) ? `[${t.map((n) => JSON.stringify(n)).join(", ")}]` : JSON.stringify(t)));
    }
    var nt = {};
    tr(nt, { error: () => Xc, info: () => Zc, log: () => zc, query: () => ep, should: () => xs, tags: () => tt, warn: () => _i });
    var tt = { error: ce("prisma:error"), warn: Ie("prisma:warn"), info: De("prisma:info"), query: nr("prisma:query") };
    var xs = { warn: () => !process.env.PRISMA_DISABLE_WARNINGS };
    function zc(...e) {
      console.log(...e);
    }
    function _i(e, ...r) {
      xs.warn() && console.warn(`${tt.warn} ${e}`, ...r);
    }
    function Zc(e, ...r) {
      console.info(`${tt.info} ${e}`, ...r);
    }
    function Xc(e, ...r) {
      console.error(`${tt.error} ${e}`, ...r);
    }
    function ep(e, ...r) {
      console.log(`${tt.query} ${e}`, ...r);
    }
    function ln(e, r) {
      if (!e) throw new Error(`${r}. This should never happen. If you see this error, please, open an issue at https://pris.ly/prisma-prisma-bug-report`);
    }
    function ar(e, r) {
      throw new Error(r);
    }
    function Ni({ onlyFirst: e = false } = {}) {
      let t = ["[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?(?:\\u0007|\\u001B\\u005C|\\u009C))", "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))"].join("|");
      return new RegExp(t, e ? void 0 : "g");
    }
    var rp = Ni();
    function wr(e) {
      if (typeof e != "string") throw new TypeError(`Expected a \`string\`, got \`${typeof e}\``);
      return e.replace(rp, "");
    }
    var it = O(require("node:path"));
    function Li(e) {
      return it.default.sep === it.default.posix.sep ? e : e.split(it.default.sep).join(it.default.posix.sep);
    }
    var qi = O(As());
    var un = O(require("node:fs"));
    var xr = O(require("node:path"));
    function Cs(e) {
      let r = e.ignoreProcessEnv ? {} : process.env, t = (n) => n.match(/(.?\${(?:[a-zA-Z0-9_]+)?})/g)?.reduce(function(o, s) {
        let a = /(.?)\${([a-zA-Z0-9_]+)?}/g.exec(s);
        if (!a) return o;
        let l = a[1], u, c;
        if (l === "\\") c = a[0], u = c.replace("\\$", "$");
        else {
          let p = a[2];
          c = a[0].substring(l.length), u = Object.hasOwnProperty.call(r, p) ? r[p] : e.parsed[p] || "", u = t(u);
        }
        return o.replace(c, u);
      }, n) ?? n;
      for (let n in e.parsed) {
        let i = Object.hasOwnProperty.call(r, n) ? r[n] : e.parsed[n];
        e.parsed[n] = t(i);
      }
      for (let n in e.parsed) r[n] = e.parsed[n];
      return e;
    }
    var $i = gr("prisma:tryLoadEnv");
    function st({ rootEnvPath: e, schemaEnvPath: r }, t = { conflictCheck: "none" }) {
      let n = Is(e);
      t.conflictCheck !== "none" && hp(n, r, t.conflictCheck);
      let i = null;
      return Ds(n?.path, r) || (i = Is(r)), !n && !i && $i("No Environment variables loaded"), i?.dotenvResult.error ? console.error(ce(W("Schema Env Error: ")) + i.dotenvResult.error) : { message: [n?.message, i?.message].filter(Boolean).join(`
`), parsed: { ...n?.dotenvResult?.parsed, ...i?.dotenvResult?.parsed } };
    }
    function hp(e, r, t) {
      let n = e?.dotenvResult.parsed, i = !Ds(e?.path, r);
      if (n && r && i && un.default.existsSync(r)) {
        let o = qi.default.parse(un.default.readFileSync(r)), s = [];
        for (let a in o) n[a] === o[a] && s.push(a);
        if (s.length > 0) {
          let a = xr.default.relative(process.cwd(), e.path), l = xr.default.relative(process.cwd(), r);
          if (t === "error") {
            let u = `There is a conflict between env var${s.length > 1 ? "s" : ""} in ${Y(a)} and ${Y(l)}
Conflicting env vars:
${s.map((c) => `  ${W(c)}`).join(`
`)}

We suggest to move the contents of ${Y(l)} to ${Y(a)} to consolidate your env vars.
`;
            throw new Error(u);
          } else if (t === "warn") {
            let u = `Conflict for env var${s.length > 1 ? "s" : ""} ${s.map((c) => W(c)).join(", ")} in ${Y(a)} and ${Y(l)}
Env vars from ${Y(l)} overwrite the ones from ${Y(a)}
      `;
            console.warn(`${Ie("warn(prisma)")} ${u}`);
          }
        }
      }
    }
    function Is(e) {
      if (yp(e)) {
        $i(`Environment variables loaded from ${e}`);
        let r = qi.default.config({ path: e, debug: process.env.DOTENV_CONFIG_DEBUG ? true : void 0 });
        return { dotenvResult: Cs(r), message: Ce(`Environment variables loaded from ${xr.default.relative(process.cwd(), e)}`), path: e };
      } else $i(`Environment variables not found at ${e}`);
      return null;
    }
    function Ds(e, r) {
      return e && r && xr.default.resolve(e) === xr.default.resolve(r);
    }
    function yp(e) {
      return !!(e && un.default.existsSync(e));
    }
    function Vi(e, r) {
      return Object.prototype.hasOwnProperty.call(e, r);
    }
    function pn(e, r) {
      let t = {};
      for (let n of Object.keys(e)) t[n] = r(e[n], n);
      return t;
    }
    function ji(e, r) {
      if (e.length === 0) return;
      let t = e[0];
      for (let n = 1; n < e.length; n++) r(t, e[n]) < 0 && (t = e[n]);
      return t;
    }
    function x(e, r) {
      Object.defineProperty(e, "name", { value: r, configurable: true });
    }
    var ks = /* @__PURE__ */ new Set();
    var at = (e, r, ...t) => {
      ks.has(e) || (ks.add(e), _i(r, ...t));
    };
    var P = class e extends Error {
      clientVersion;
      errorCode;
      retryable;
      constructor(r, t, n) {
        super(r), this.name = "PrismaClientInitializationError", this.clientVersion = t, this.errorCode = n, Error.captureStackTrace(e);
      }
      get [Symbol.toStringTag]() {
        return "PrismaClientInitializationError";
      }
    };
    x(P, "PrismaClientInitializationError");
    var z2 = class extends Error {
      code;
      meta;
      clientVersion;
      batchRequestIdx;
      constructor(r, { code: t, clientVersion: n, meta: i, batchRequestIdx: o }) {
        super(r), this.name = "PrismaClientKnownRequestError", this.code = t, this.clientVersion = n, this.meta = i, Object.defineProperty(this, "batchRequestIdx", { value: o, enumerable: false, writable: true });
      }
      get [Symbol.toStringTag]() {
        return "PrismaClientKnownRequestError";
      }
    };
    x(z2, "PrismaClientKnownRequestError");
    var ae = class extends Error {
      clientVersion;
      constructor(r, t) {
        super(r), this.name = "PrismaClientRustPanicError", this.clientVersion = t;
      }
      get [Symbol.toStringTag]() {
        return "PrismaClientRustPanicError";
      }
    };
    x(ae, "PrismaClientRustPanicError");
    var V = class extends Error {
      clientVersion;
      batchRequestIdx;
      constructor(r, { clientVersion: t, batchRequestIdx: n }) {
        super(r), this.name = "PrismaClientUnknownRequestError", this.clientVersion = t, Object.defineProperty(this, "batchRequestIdx", { value: n, writable: true, enumerable: false });
      }
      get [Symbol.toStringTag]() {
        return "PrismaClientUnknownRequestError";
      }
    };
    x(V, "PrismaClientUnknownRequestError");
    var Z = class extends Error {
      name = "PrismaClientValidationError";
      clientVersion;
      constructor(r, { clientVersion: t }) {
        super(r), this.clientVersion = t;
      }
      get [Symbol.toStringTag]() {
        return "PrismaClientValidationError";
      }
    };
    x(Z, "PrismaClientValidationError");
    var we = class {
      _map = /* @__PURE__ */ new Map();
      get(r) {
        return this._map.get(r)?.value;
      }
      set(r, t) {
        this._map.set(r, { value: t });
      }
      getOrCreate(r, t) {
        let n = this._map.get(r);
        if (n) return n.value;
        let i = t();
        return this.set(r, i), i;
      }
    };
    function We(e) {
      return e.substring(0, 1).toLowerCase() + e.substring(1);
    }
    function _s(e, r) {
      let t = {};
      for (let n of e) {
        let i = n[r];
        t[i] = n;
      }
      return t;
    }
    function lt(e) {
      let r;
      return { get() {
        return r || (r = { value: e() }), r.value;
      } };
    }
    function Ns(e) {
      return { models: Bi(e.models), enums: Bi(e.enums), types: Bi(e.types) };
    }
    function Bi(e) {
      let r = {};
      for (let { name: t, ...n } of e) r[t] = n;
      return r;
    }
    function vr(e) {
      return e instanceof Date || Object.prototype.toString.call(e) === "[object Date]";
    }
    function mn(e) {
      return e.toString() !== "Invalid Date";
    }
    var Pr = 9e15;
    var Ye = 1e9;
    var Ui = "0123456789abcdef";
    var hn = "2.3025850929940456840179914546843642076011014886287729760333279009675726096773524802359972050895982983419677840422862486334095254650828067566662873690987816894829072083255546808437998948262331985283935053089653777326288461633662222876982198867465436674744042432743651550489343149393914796194044002221051017141748003688084012647080685567743216228355220114804663715659121373450747856947683463616792101806445070648000277502684916746550586856935673420670581136429224554405758925724208241314695689016758940256776311356919292033376587141660230105703089634572075440370847469940168269282808481184289314848524948644871927809676271275775397027668605952496716674183485704422507197965004714951050492214776567636938662976979522110718264549734772662425709429322582798502585509785265383207606726317164309505995087807523710333101197857547331541421808427543863591778117054309827482385045648019095610299291824318237525357709750539565187697510374970888692180205189339507238539205144634197265287286965110862571492198849978748873771345686209167058";
    var yn = "3.1415926535897932384626433832795028841971693993751058209749445923078164062862089986280348253421170679821480865132823066470938446095505822317253594081284811174502841027019385211055596446229489549303819644288109756659334461284756482337867831652712019091456485669234603486104543266482133936072602491412737245870066063155881748815209209628292540917153643678925903600113305305488204665213841469519415116094330572703657595919530921861173819326117931051185480744623799627495673518857527248912279381830119491298336733624406566430860213949463952247371907021798609437027705392171762931767523846748184676694051320005681271452635608277857713427577896091736371787214684409012249534301465495853710507922796892589235420199561121290219608640344181598136297747713099605187072113499999983729780499510597317328160963185950244594553469083026425223082533446850352619311881710100031378387528865875332083814206171776691473035982534904287554687311595628638823537875937519577818577805321712268066130019278766111959092164201989380952572010654858632789";
    var Gi = { precision: 20, rounding: 4, modulo: 1, toExpNeg: -7, toExpPos: 21, minE: -Pr, maxE: Pr, crypto: false };
    var $s;
    var Ne;
    var w = true;
    var En = "[DecimalError] ";
    var He = En + "Invalid argument: ";
    var qs = En + "Precision limit exceeded";
    var Vs = En + "crypto unavailable";
    var js = "[object Decimal]";
    var X = Math.floor;
    var U = Math.pow;
    var bp = /^0b([01]+(\.[01]*)?|\.[01]+)(p[+-]?\d+)?$/i;
    var Ep = /^0x([0-9a-f]+(\.[0-9a-f]*)?|\.[0-9a-f]+)(p[+-]?\d+)?$/i;
    var wp = /^0o([0-7]+(\.[0-7]*)?|\.[0-7]+)(p[+-]?\d+)?$/i;
    var Bs = /^(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;
    var fe = 1e7;
    var E = 7;
    var xp = 9007199254740991;
    var vp = hn.length - 1;
    var Qi = yn.length - 1;
    var m = { toStringTag: js };
    m.absoluteValue = m.abs = function() {
      var e = new this.constructor(this);
      return e.s < 0 && (e.s = 1), y(e);
    };
    m.ceil = function() {
      return y(new this.constructor(this), this.e + 1, 2);
    };
    m.clampedTo = m.clamp = function(e, r) {
      var t, n = this, i = n.constructor;
      if (e = new i(e), r = new i(r), !e.s || !r.s) return new i(NaN);
      if (e.gt(r)) throw Error(He + r);
      return t = n.cmp(e), t < 0 ? e : n.cmp(r) > 0 ? r : new i(n);
    };
    m.comparedTo = m.cmp = function(e) {
      var r, t, n, i, o = this, s = o.d, a = (e = new o.constructor(e)).d, l = o.s, u = e.s;
      if (!s || !a) return !l || !u ? NaN : l !== u ? l : s === a ? 0 : !s ^ l < 0 ? 1 : -1;
      if (!s[0] || !a[0]) return s[0] ? l : a[0] ? -u : 0;
      if (l !== u) return l;
      if (o.e !== e.e) return o.e > e.e ^ l < 0 ? 1 : -1;
      for (n = s.length, i = a.length, r = 0, t = n < i ? n : i; r < t; ++r) if (s[r] !== a[r]) return s[r] > a[r] ^ l < 0 ? 1 : -1;
      return n === i ? 0 : n > i ^ l < 0 ? 1 : -1;
    };
    m.cosine = m.cos = function() {
      var e, r, t = this, n = t.constructor;
      return t.d ? t.d[0] ? (e = n.precision, r = n.rounding, n.precision = e + Math.max(t.e, t.sd()) + E, n.rounding = 1, t = Pp(n, Js(n, t)), n.precision = e, n.rounding = r, y(Ne == 2 || Ne == 3 ? t.neg() : t, e, r, true)) : new n(1) : new n(NaN);
    };
    m.cubeRoot = m.cbrt = function() {
      var e, r, t, n, i, o, s, a, l, u, c = this, p = c.constructor;
      if (!c.isFinite() || c.isZero()) return new p(c);
      for (w = false, o = c.s * U(c.s * c, 1 / 3), !o || Math.abs(o) == 1 / 0 ? (t = J(c.d), e = c.e, (o = (e - t.length + 1) % 3) && (t += o == 1 || o == -2 ? "0" : "00"), o = U(t, 1 / 3), e = X((e + 1) / 3) - (e % 3 == (e < 0 ? -1 : 2)), o == 1 / 0 ? t = "5e" + e : (t = o.toExponential(), t = t.slice(0, t.indexOf("e") + 1) + e), n = new p(t), n.s = c.s) : n = new p(o.toString()), s = (e = p.precision) + 3; ; ) if (a = n, l = a.times(a).times(a), u = l.plus(c), n = L(u.plus(c).times(a), u.plus(l), s + 2, 1), J(a.d).slice(0, s) === (t = J(n.d)).slice(0, s)) if (t = t.slice(s - 3, s + 1), t == "9999" || !i && t == "4999") {
        if (!i && (y(a, e + 1, 0), a.times(a).times(a).eq(c))) {
          n = a;
          break;
        }
        s += 4, i = 1;
      } else {
        (!+t || !+t.slice(1) && t.charAt(0) == "5") && (y(n, e + 1, 1), r = !n.times(n).times(n).eq(c));
        break;
      }
      return w = true, y(n, e, p.rounding, r);
    };
    m.decimalPlaces = m.dp = function() {
      var e, r = this.d, t = NaN;
      if (r) {
        if (e = r.length - 1, t = (e - X(this.e / E)) * E, e = r[e], e) for (; e % 10 == 0; e /= 10) t--;
        t < 0 && (t = 0);
      }
      return t;
    };
    m.dividedBy = m.div = function(e) {
      return L(this, new this.constructor(e));
    };
    m.dividedToIntegerBy = m.divToInt = function(e) {
      var r = this, t = r.constructor;
      return y(L(r, new t(e), 0, 1, 1), t.precision, t.rounding);
    };
    m.equals = m.eq = function(e) {
      return this.cmp(e) === 0;
    };
    m.floor = function() {
      return y(new this.constructor(this), this.e + 1, 3);
    };
    m.greaterThan = m.gt = function(e) {
      return this.cmp(e) > 0;
    };
    m.greaterThanOrEqualTo = m.gte = function(e) {
      var r = this.cmp(e);
      return r == 1 || r === 0;
    };
    m.hyperbolicCosine = m.cosh = function() {
      var e, r, t, n, i, o = this, s = o.constructor, a = new s(1);
      if (!o.isFinite()) return new s(o.s ? 1 / 0 : NaN);
      if (o.isZero()) return a;
      t = s.precision, n = s.rounding, s.precision = t + Math.max(o.e, o.sd()) + 4, s.rounding = 1, i = o.d.length, i < 32 ? (e = Math.ceil(i / 3), r = (1 / xn(4, e)).toString()) : (e = 16, r = "2.3283064365386962890625e-10"), o = Tr(s, 1, o.times(r), new s(1), true);
      for (var l, u = e, c = new s(8); u--; ) l = o.times(o), o = a.minus(l.times(c.minus(l.times(c))));
      return y(o, s.precision = t, s.rounding = n, true);
    };
    m.hyperbolicSine = m.sinh = function() {
      var e, r, t, n, i = this, o = i.constructor;
      if (!i.isFinite() || i.isZero()) return new o(i);
      if (r = o.precision, t = o.rounding, o.precision = r + Math.max(i.e, i.sd()) + 4, o.rounding = 1, n = i.d.length, n < 3) i = Tr(o, 2, i, i, true);
      else {
        e = 1.4 * Math.sqrt(n), e = e > 16 ? 16 : e | 0, i = i.times(1 / xn(5, e)), i = Tr(o, 2, i, i, true);
        for (var s, a = new o(5), l = new o(16), u = new o(20); e--; ) s = i.times(i), i = i.times(a.plus(s.times(l.times(s).plus(u))));
      }
      return o.precision = r, o.rounding = t, y(i, r, t, true);
    };
    m.hyperbolicTangent = m.tanh = function() {
      var e, r, t = this, n = t.constructor;
      return t.isFinite() ? t.isZero() ? new n(t) : (e = n.precision, r = n.rounding, n.precision = e + 7, n.rounding = 1, L(t.sinh(), t.cosh(), n.precision = e, n.rounding = r)) : new n(t.s);
    };
    m.inverseCosine = m.acos = function() {
      var e = this, r = e.constructor, t = e.abs().cmp(1), n = r.precision, i = r.rounding;
      return t !== -1 ? t === 0 ? e.isNeg() ? xe(r, n, i) : new r(0) : new r(NaN) : e.isZero() ? xe(r, n + 4, i).times(0.5) : (r.precision = n + 6, r.rounding = 1, e = new r(1).minus(e).div(e.plus(1)).sqrt().atan(), r.precision = n, r.rounding = i, e.times(2));
    };
    m.inverseHyperbolicCosine = m.acosh = function() {
      var e, r, t = this, n = t.constructor;
      return t.lte(1) ? new n(t.eq(1) ? 0 : NaN) : t.isFinite() ? (e = n.precision, r = n.rounding, n.precision = e + Math.max(Math.abs(t.e), t.sd()) + 4, n.rounding = 1, w = false, t = t.times(t).minus(1).sqrt().plus(t), w = true, n.precision = e, n.rounding = r, t.ln()) : new n(t);
    };
    m.inverseHyperbolicSine = m.asinh = function() {
      var e, r, t = this, n = t.constructor;
      return !t.isFinite() || t.isZero() ? new n(t) : (e = n.precision, r = n.rounding, n.precision = e + 2 * Math.max(Math.abs(t.e), t.sd()) + 6, n.rounding = 1, w = false, t = t.times(t).plus(1).sqrt().plus(t), w = true, n.precision = e, n.rounding = r, t.ln());
    };
    m.inverseHyperbolicTangent = m.atanh = function() {
      var e, r, t, n, i = this, o = i.constructor;
      return i.isFinite() ? i.e >= 0 ? new o(i.abs().eq(1) ? i.s / 0 : i.isZero() ? i : NaN) : (e = o.precision, r = o.rounding, n = i.sd(), Math.max(n, e) < 2 * -i.e - 1 ? y(new o(i), e, r, true) : (o.precision = t = n - i.e, i = L(i.plus(1), new o(1).minus(i), t + e, 1), o.precision = e + 4, o.rounding = 1, i = i.ln(), o.precision = e, o.rounding = r, i.times(0.5))) : new o(NaN);
    };
    m.inverseSine = m.asin = function() {
      var e, r, t, n, i = this, o = i.constructor;
      return i.isZero() ? new o(i) : (r = i.abs().cmp(1), t = o.precision, n = o.rounding, r !== -1 ? r === 0 ? (e = xe(o, t + 4, n).times(0.5), e.s = i.s, e) : new o(NaN) : (o.precision = t + 6, o.rounding = 1, i = i.div(new o(1).minus(i.times(i)).sqrt().plus(1)).atan(), o.precision = t, o.rounding = n, i.times(2)));
    };
    m.inverseTangent = m.atan = function() {
      var e, r, t, n, i, o, s, a, l, u = this, c = u.constructor, p = c.precision, d = c.rounding;
      if (u.isFinite()) {
        if (u.isZero()) return new c(u);
        if (u.abs().eq(1) && p + 4 <= Qi) return s = xe(c, p + 4, d).times(0.25), s.s = u.s, s;
      } else {
        if (!u.s) return new c(NaN);
        if (p + 4 <= Qi) return s = xe(c, p + 4, d).times(0.5), s.s = u.s, s;
      }
      for (c.precision = a = p + 10, c.rounding = 1, t = Math.min(28, a / E + 2 | 0), e = t; e; --e) u = u.div(u.times(u).plus(1).sqrt().plus(1));
      for (w = false, r = Math.ceil(a / E), n = 1, l = u.times(u), s = new c(u), i = u; e !== -1; ) if (i = i.times(l), o = s.minus(i.div(n += 2)), i = i.times(l), s = o.plus(i.div(n += 2)), s.d[r] !== void 0) for (e = r; s.d[e] === o.d[e] && e--; ) ;
      return t && (s = s.times(2 << t - 1)), w = true, y(s, c.precision = p, c.rounding = d, true);
    };
    m.isFinite = function() {
      return !!this.d;
    };
    m.isInteger = m.isInt = function() {
      return !!this.d && X(this.e / E) > this.d.length - 2;
    };
    m.isNaN = function() {
      return !this.s;
    };
    m.isNegative = m.isNeg = function() {
      return this.s < 0;
    };
    m.isPositive = m.isPos = function() {
      return this.s > 0;
    };
    m.isZero = function() {
      return !!this.d && this.d[0] === 0;
    };
    m.lessThan = m.lt = function(e) {
      return this.cmp(e) < 0;
    };
    m.lessThanOrEqualTo = m.lte = function(e) {
      return this.cmp(e) < 1;
    };
    m.logarithm = m.log = function(e) {
      var r, t, n, i, o, s, a, l, u = this, c = u.constructor, p = c.precision, d = c.rounding, f = 5;
      if (e == null) e = new c(10), r = true;
      else {
        if (e = new c(e), t = e.d, e.s < 0 || !t || !t[0] || e.eq(1)) return new c(NaN);
        r = e.eq(10);
      }
      if (t = u.d, u.s < 0 || !t || !t[0] || u.eq(1)) return new c(t && !t[0] ? -1 / 0 : u.s != 1 ? NaN : t ? 0 : 1 / 0);
      if (r) if (t.length > 1) o = true;
      else {
        for (i = t[0]; i % 10 === 0; ) i /= 10;
        o = i !== 1;
      }
      if (w = false, a = p + f, s = Ke(u, a), n = r ? bn(c, a + 10) : Ke(e, a), l = L(s, n, a, 1), ut(l.d, i = p, d)) do
        if (a += 10, s = Ke(u, a), n = r ? bn(c, a + 10) : Ke(e, a), l = L(s, n, a, 1), !o) {
          +J(l.d).slice(i + 1, i + 15) + 1 == 1e14 && (l = y(l, p + 1, 0));
          break;
        }
      while (ut(l.d, i += 10, d));
      return w = true, y(l, p, d);
    };
    m.minus = m.sub = function(e) {
      var r, t, n, i, o, s, a, l, u, c, p, d, f = this, h = f.constructor;
      if (e = new h(e), !f.d || !e.d) return !f.s || !e.s ? e = new h(NaN) : f.d ? e.s = -e.s : e = new h(e.d || f.s !== e.s ? f : NaN), e;
      if (f.s != e.s) return e.s = -e.s, f.plus(e);
      if (u = f.d, d = e.d, a = h.precision, l = h.rounding, !u[0] || !d[0]) {
        if (d[0]) e.s = -e.s;
        else if (u[0]) e = new h(f);
        else return new h(l === 3 ? -0 : 0);
        return w ? y(e, a, l) : e;
      }
      if (t = X(e.e / E), c = X(f.e / E), u = u.slice(), o = c - t, o) {
        for (p = o < 0, p ? (r = u, o = -o, s = d.length) : (r = d, t = c, s = u.length), n = Math.max(Math.ceil(a / E), s) + 2, o > n && (o = n, r.length = 1), r.reverse(), n = o; n--; ) r.push(0);
        r.reverse();
      } else {
        for (n = u.length, s = d.length, p = n < s, p && (s = n), n = 0; n < s; n++) if (u[n] != d[n]) {
          p = u[n] < d[n];
          break;
        }
        o = 0;
      }
      for (p && (r = u, u = d, d = r, e.s = -e.s), s = u.length, n = d.length - s; n > 0; --n) u[s++] = 0;
      for (n = d.length; n > o; ) {
        if (u[--n] < d[n]) {
          for (i = n; i && u[--i] === 0; ) u[i] = fe - 1;
          --u[i], u[n] += fe;
        }
        u[n] -= d[n];
      }
      for (; u[--s] === 0; ) u.pop();
      for (; u[0] === 0; u.shift()) --t;
      return u[0] ? (e.d = u, e.e = wn(u, t), w ? y(e, a, l) : e) : new h(l === 3 ? -0 : 0);
    };
    m.modulo = m.mod = function(e) {
      var r, t = this, n = t.constructor;
      return e = new n(e), !t.d || !e.s || e.d && !e.d[0] ? new n(NaN) : !e.d || t.d && !t.d[0] ? y(new n(t), n.precision, n.rounding) : (w = false, n.modulo == 9 ? (r = L(t, e.abs(), 0, 3, 1), r.s *= e.s) : r = L(t, e, 0, n.modulo, 1), r = r.times(e), w = true, t.minus(r));
    };
    m.naturalExponential = m.exp = function() {
      return Wi(this);
    };
    m.naturalLogarithm = m.ln = function() {
      return Ke(this);
    };
    m.negated = m.neg = function() {
      var e = new this.constructor(this);
      return e.s = -e.s, y(e);
    };
    m.plus = m.add = function(e) {
      var r, t, n, i, o, s, a, l, u, c, p = this, d = p.constructor;
      if (e = new d(e), !p.d || !e.d) return !p.s || !e.s ? e = new d(NaN) : p.d || (e = new d(e.d || p.s === e.s ? p : NaN)), e;
      if (p.s != e.s) return e.s = -e.s, p.minus(e);
      if (u = p.d, c = e.d, a = d.precision, l = d.rounding, !u[0] || !c[0]) return c[0] || (e = new d(p)), w ? y(e, a, l) : e;
      if (o = X(p.e / E), n = X(e.e / E), u = u.slice(), i = o - n, i) {
        for (i < 0 ? (t = u, i = -i, s = c.length) : (t = c, n = o, s = u.length), o = Math.ceil(a / E), s = o > s ? o + 1 : s + 1, i > s && (i = s, t.length = 1), t.reverse(); i--; ) t.push(0);
        t.reverse();
      }
      for (s = u.length, i = c.length, s - i < 0 && (i = s, t = c, c = u, u = t), r = 0; i; ) r = (u[--i] = u[i] + c[i] + r) / fe | 0, u[i] %= fe;
      for (r && (u.unshift(r), ++n), s = u.length; u[--s] == 0; ) u.pop();
      return e.d = u, e.e = wn(u, n), w ? y(e, a, l) : e;
    };
    m.precision = m.sd = function(e) {
      var r, t = this;
      if (e !== void 0 && e !== !!e && e !== 1 && e !== 0) throw Error(He + e);
      return t.d ? (r = Us(t.d), e && t.e + 1 > r && (r = t.e + 1)) : r = NaN, r;
    };
    m.round = function() {
      var e = this, r = e.constructor;
      return y(new r(e), e.e + 1, r.rounding);
    };
    m.sine = m.sin = function() {
      var e, r, t = this, n = t.constructor;
      return t.isFinite() ? t.isZero() ? new n(t) : (e = n.precision, r = n.rounding, n.precision = e + Math.max(t.e, t.sd()) + E, n.rounding = 1, t = Sp(n, Js(n, t)), n.precision = e, n.rounding = r, y(Ne > 2 ? t.neg() : t, e, r, true)) : new n(NaN);
    };
    m.squareRoot = m.sqrt = function() {
      var e, r, t, n, i, o, s = this, a = s.d, l = s.e, u = s.s, c = s.constructor;
      if (u !== 1 || !a || !a[0]) return new c(!u || u < 0 && (!a || a[0]) ? NaN : a ? s : 1 / 0);
      for (w = false, u = Math.sqrt(+s), u == 0 || u == 1 / 0 ? (r = J(a), (r.length + l) % 2 == 0 && (r += "0"), u = Math.sqrt(r), l = X((l + 1) / 2) - (l < 0 || l % 2), u == 1 / 0 ? r = "5e" + l : (r = u.toExponential(), r = r.slice(0, r.indexOf("e") + 1) + l), n = new c(r)) : n = new c(u.toString()), t = (l = c.precision) + 3; ; ) if (o = n, n = o.plus(L(s, o, t + 2, 1)).times(0.5), J(o.d).slice(0, t) === (r = J(n.d)).slice(0, t)) if (r = r.slice(t - 3, t + 1), r == "9999" || !i && r == "4999") {
        if (!i && (y(o, l + 1, 0), o.times(o).eq(s))) {
          n = o;
          break;
        }
        t += 4, i = 1;
      } else {
        (!+r || !+r.slice(1) && r.charAt(0) == "5") && (y(n, l + 1, 1), e = !n.times(n).eq(s));
        break;
      }
      return w = true, y(n, l, c.rounding, e);
    };
    m.tangent = m.tan = function() {
      var e, r, t = this, n = t.constructor;
      return t.isFinite() ? t.isZero() ? new n(t) : (e = n.precision, r = n.rounding, n.precision = e + 10, n.rounding = 1, t = t.sin(), t.s = 1, t = L(t, new n(1).minus(t.times(t)).sqrt(), e + 10, 0), n.precision = e, n.rounding = r, y(Ne == 2 || Ne == 4 ? t.neg() : t, e, r, true)) : new n(NaN);
    };
    m.times = m.mul = function(e) {
      var r, t, n, i, o, s, a, l, u, c = this, p = c.constructor, d = c.d, f = (e = new p(e)).d;
      if (e.s *= c.s, !d || !d[0] || !f || !f[0]) return new p(!e.s || d && !d[0] && !f || f && !f[0] && !d ? NaN : !d || !f ? e.s / 0 : e.s * 0);
      for (t = X(c.e / E) + X(e.e / E), l = d.length, u = f.length, l < u && (o = d, d = f, f = o, s = l, l = u, u = s), o = [], s = l + u, n = s; n--; ) o.push(0);
      for (n = u; --n >= 0; ) {
        for (r = 0, i = l + n; i > n; ) a = o[i] + f[n] * d[i - n - 1] + r, o[i--] = a % fe | 0, r = a / fe | 0;
        o[i] = (o[i] + r) % fe | 0;
      }
      for (; !o[--s]; ) o.pop();
      return r ? ++t : o.shift(), e.d = o, e.e = wn(o, t), w ? y(e, p.precision, p.rounding) : e;
    };
    m.toBinary = function(e, r) {
      return Ji(this, 2, e, r);
    };
    m.toDecimalPlaces = m.toDP = function(e, r) {
      var t = this, n = t.constructor;
      return t = new n(t), e === void 0 ? t : (ne(e, 0, Ye), r === void 0 ? r = n.rounding : ne(r, 0, 8), y(t, e + t.e + 1, r));
    };
    m.toExponential = function(e, r) {
      var t, n = this, i = n.constructor;
      return e === void 0 ? t = ve(n, true) : (ne(e, 0, Ye), r === void 0 ? r = i.rounding : ne(r, 0, 8), n = y(new i(n), e + 1, r), t = ve(n, true, e + 1)), n.isNeg() && !n.isZero() ? "-" + t : t;
    };
    m.toFixed = function(e, r) {
      var t, n, i = this, o = i.constructor;
      return e === void 0 ? t = ve(i) : (ne(e, 0, Ye), r === void 0 ? r = o.rounding : ne(r, 0, 8), n = y(new o(i), e + i.e + 1, r), t = ve(n, false, e + n.e + 1)), i.isNeg() && !i.isZero() ? "-" + t : t;
    };
    m.toFraction = function(e) {
      var r, t, n, i, o, s, a, l, u, c, p, d, f = this, h = f.d, g = f.constructor;
      if (!h) return new g(f);
      if (u = t = new g(1), n = l = new g(0), r = new g(n), o = r.e = Us(h) - f.e - 1, s = o % E, r.d[0] = U(10, s < 0 ? E + s : s), e == null) e = o > 0 ? r : u;
      else {
        if (a = new g(e), !a.isInt() || a.lt(u)) throw Error(He + a);
        e = a.gt(r) ? o > 0 ? r : u : a;
      }
      for (w = false, a = new g(J(h)), c = g.precision, g.precision = o = h.length * E * 2; p = L(a, r, 0, 1, 1), i = t.plus(p.times(n)), i.cmp(e) != 1; ) t = n, n = i, i = u, u = l.plus(p.times(i)), l = i, i = r, r = a.minus(p.times(i)), a = i;
      return i = L(e.minus(t), n, 0, 1, 1), l = l.plus(i.times(u)), t = t.plus(i.times(n)), l.s = u.s = f.s, d = L(u, n, o, 1).minus(f).abs().cmp(L(l, t, o, 1).minus(f).abs()) < 1 ? [u, n] : [l, t], g.precision = c, w = true, d;
    };
    m.toHexadecimal = m.toHex = function(e, r) {
      return Ji(this, 16, e, r);
    };
    m.toNearest = function(e, r) {
      var t = this, n = t.constructor;
      if (t = new n(t), e == null) {
        if (!t.d) return t;
        e = new n(1), r = n.rounding;
      } else {
        if (e = new n(e), r === void 0 ? r = n.rounding : ne(r, 0, 8), !t.d) return e.s ? t : e;
        if (!e.d) return e.s && (e.s = t.s), e;
      }
      return e.d[0] ? (w = false, t = L(t, e, 0, r, 1).times(e), w = true, y(t)) : (e.s = t.s, t = e), t;
    };
    m.toNumber = function() {
      return +this;
    };
    m.toOctal = function(e, r) {
      return Ji(this, 8, e, r);
    };
    m.toPower = m.pow = function(e) {
      var r, t, n, i, o, s, a = this, l = a.constructor, u = +(e = new l(e));
      if (!a.d || !e.d || !a.d[0] || !e.d[0]) return new l(U(+a, u));
      if (a = new l(a), a.eq(1)) return a;
      if (n = l.precision, o = l.rounding, e.eq(1)) return y(a, n, o);
      if (r = X(e.e / E), r >= e.d.length - 1 && (t = u < 0 ? -u : u) <= xp) return i = Gs(l, a, t, n), e.s < 0 ? new l(1).div(i) : y(i, n, o);
      if (s = a.s, s < 0) {
        if (r < e.d.length - 1) return new l(NaN);
        if ((e.d[r] & 1) == 0 && (s = 1), a.e == 0 && a.d[0] == 1 && a.d.length == 1) return a.s = s, a;
      }
      return t = U(+a, u), r = t == 0 || !isFinite(t) ? X(u * (Math.log("0." + J(a.d)) / Math.LN10 + a.e + 1)) : new l(t + "").e, r > l.maxE + 1 || r < l.minE - 1 ? new l(r > 0 ? s / 0 : 0) : (w = false, l.rounding = a.s = 1, t = Math.min(12, (r + "").length), i = Wi(e.times(Ke(a, n + t)), n), i.d && (i = y(i, n + 5, 1), ut(i.d, n, o) && (r = n + 10, i = y(Wi(e.times(Ke(a, r + t)), r), r + 5, 1), +J(i.d).slice(n + 1, n + 15) + 1 == 1e14 && (i = y(i, n + 1, 0)))), i.s = s, w = true, l.rounding = o, y(i, n, o));
    };
    m.toPrecision = function(e, r) {
      var t, n = this, i = n.constructor;
      return e === void 0 ? t = ve(n, n.e <= i.toExpNeg || n.e >= i.toExpPos) : (ne(e, 1, Ye), r === void 0 ? r = i.rounding : ne(r, 0, 8), n = y(new i(n), e, r), t = ve(n, e <= n.e || n.e <= i.toExpNeg, e)), n.isNeg() && !n.isZero() ? "-" + t : t;
    };
    m.toSignificantDigits = m.toSD = function(e, r) {
      var t = this, n = t.constructor;
      return e === void 0 ? (e = n.precision, r = n.rounding) : (ne(e, 1, Ye), r === void 0 ? r = n.rounding : ne(r, 0, 8)), y(new n(t), e, r);
    };
    m.toString = function() {
      var e = this, r = e.constructor, t = ve(e, e.e <= r.toExpNeg || e.e >= r.toExpPos);
      return e.isNeg() && !e.isZero() ? "-" + t : t;
    };
    m.truncated = m.trunc = function() {
      return y(new this.constructor(this), this.e + 1, 1);
    };
    m.valueOf = m.toJSON = function() {
      var e = this, r = e.constructor, t = ve(e, e.e <= r.toExpNeg || e.e >= r.toExpPos);
      return e.isNeg() ? "-" + t : t;
    };
    function J(e) {
      var r, t, n, i = e.length - 1, o = "", s = e[0];
      if (i > 0) {
        for (o += s, r = 1; r < i; r++) n = e[r] + "", t = E - n.length, t && (o += Je(t)), o += n;
        s = e[r], n = s + "", t = E - n.length, t && (o += Je(t));
      } else if (s === 0) return "0";
      for (; s % 10 === 0; ) s /= 10;
      return o + s;
    }
    function ne(e, r, t) {
      if (e !== ~~e || e < r || e > t) throw Error(He + e);
    }
    function ut(e, r, t, n) {
      var i, o, s, a;
      for (o = e[0]; o >= 10; o /= 10) --r;
      return --r < 0 ? (r += E, i = 0) : (i = Math.ceil((r + 1) / E), r %= E), o = U(10, E - r), a = e[i] % o | 0, n == null ? r < 3 ? (r == 0 ? a = a / 100 | 0 : r == 1 && (a = a / 10 | 0), s = t < 4 && a == 99999 || t > 3 && a == 49999 || a == 5e4 || a == 0) : s = (t < 4 && a + 1 == o || t > 3 && a + 1 == o / 2) && (e[i + 1] / o / 100 | 0) == U(10, r - 2) - 1 || (a == o / 2 || a == 0) && (e[i + 1] / o / 100 | 0) == 0 : r < 4 ? (r == 0 ? a = a / 1e3 | 0 : r == 1 ? a = a / 100 | 0 : r == 2 && (a = a / 10 | 0), s = (n || t < 4) && a == 9999 || !n && t > 3 && a == 4999) : s = ((n || t < 4) && a + 1 == o || !n && t > 3 && a + 1 == o / 2) && (e[i + 1] / o / 1e3 | 0) == U(10, r - 3) - 1, s;
    }
    function fn(e, r, t) {
      for (var n, i = [0], o, s = 0, a = e.length; s < a; ) {
        for (o = i.length; o--; ) i[o] *= r;
        for (i[0] += Ui.indexOf(e.charAt(s++)), n = 0; n < i.length; n++) i[n] > t - 1 && (i[n + 1] === void 0 && (i[n + 1] = 0), i[n + 1] += i[n] / t | 0, i[n] %= t);
      }
      return i.reverse();
    }
    function Pp(e, r) {
      var t, n, i;
      if (r.isZero()) return r;
      n = r.d.length, n < 32 ? (t = Math.ceil(n / 3), i = (1 / xn(4, t)).toString()) : (t = 16, i = "2.3283064365386962890625e-10"), e.precision += t, r = Tr(e, 1, r.times(i), new e(1));
      for (var o = t; o--; ) {
        var s = r.times(r);
        r = s.times(s).minus(s).times(8).plus(1);
      }
      return e.precision -= t, r;
    }
    var L = /* @__PURE__ */ function() {
      function e(n, i, o) {
        var s, a = 0, l = n.length;
        for (n = n.slice(); l--; ) s = n[l] * i + a, n[l] = s % o | 0, a = s / o | 0;
        return a && n.unshift(a), n;
      }
      function r(n, i, o, s) {
        var a, l;
        if (o != s) l = o > s ? 1 : -1;
        else for (a = l = 0; a < o; a++) if (n[a] != i[a]) {
          l = n[a] > i[a] ? 1 : -1;
          break;
        }
        return l;
      }
      function t(n, i, o, s) {
        for (var a = 0; o--; ) n[o] -= a, a = n[o] < i[o] ? 1 : 0, n[o] = a * s + n[o] - i[o];
        for (; !n[0] && n.length > 1; ) n.shift();
      }
      return function(n, i, o, s, a, l) {
        var u, c, p, d, f, h, g, I, T, S, b, D, me, se, Kr, j, te, Ae, K, fr, Vt = n.constructor, ti = n.s == i.s ? 1 : -1, H = n.d, k = i.d;
        if (!H || !H[0] || !k || !k[0]) return new Vt(!n.s || !i.s || (H ? k && H[0] == k[0] : !k) ? NaN : H && H[0] == 0 || !k ? ti * 0 : ti / 0);
        for (l ? (f = 1, c = n.e - i.e) : (l = fe, f = E, c = X(n.e / f) - X(i.e / f)), K = k.length, te = H.length, T = new Vt(ti), S = T.d = [], p = 0; k[p] == (H[p] || 0); p++) ;
        if (k[p] > (H[p] || 0) && c--, o == null ? (se = o = Vt.precision, s = Vt.rounding) : a ? se = o + (n.e - i.e) + 1 : se = o, se < 0) S.push(1), h = true;
        else {
          if (se = se / f + 2 | 0, p = 0, K == 1) {
            for (d = 0, k = k[0], se++; (p < te || d) && se--; p++) Kr = d * l + (H[p] || 0), S[p] = Kr / k | 0, d = Kr % k | 0;
            h = d || p < te;
          } else {
            for (d = l / (k[0] + 1) | 0, d > 1 && (k = e(k, d, l), H = e(H, d, l), K = k.length, te = H.length), j = K, b = H.slice(0, K), D = b.length; D < K; ) b[D++] = 0;
            fr = k.slice(), fr.unshift(0), Ae = k[0], k[1] >= l / 2 && ++Ae;
            do
              d = 0, u = r(k, b, K, D), u < 0 ? (me = b[0], K != D && (me = me * l + (b[1] || 0)), d = me / Ae | 0, d > 1 ? (d >= l && (d = l - 1), g = e(k, d, l), I = g.length, D = b.length, u = r(g, b, I, D), u == 1 && (d--, t(g, K < I ? fr : k, I, l))) : (d == 0 && (u = d = 1), g = k.slice()), I = g.length, I < D && g.unshift(0), t(b, g, D, l), u == -1 && (D = b.length, u = r(k, b, K, D), u < 1 && (d++, t(b, K < D ? fr : k, D, l))), D = b.length) : u === 0 && (d++, b = [0]), S[p++] = d, u && b[0] ? b[D++] = H[j] || 0 : (b = [H[j]], D = 1);
            while ((j++ < te || b[0] !== void 0) && se--);
            h = b[0] !== void 0;
          }
          S[0] || S.shift();
        }
        if (f == 1) T.e = c, $s = h;
        else {
          for (p = 1, d = S[0]; d >= 10; d /= 10) p++;
          T.e = p + c * f - 1, y(T, a ? o + T.e + 1 : o, s, h);
        }
        return T;
      };
    }();
    function y(e, r, t, n) {
      var i, o, s, a, l, u, c, p, d, f = e.constructor;
      e: if (r != null) {
        if (p = e.d, !p) return e;
        for (i = 1, a = p[0]; a >= 10; a /= 10) i++;
        if (o = r - i, o < 0) o += E, s = r, c = p[d = 0], l = c / U(10, i - s - 1) % 10 | 0;
        else if (d = Math.ceil((o + 1) / E), a = p.length, d >= a) if (n) {
          for (; a++ <= d; ) p.push(0);
          c = l = 0, i = 1, o %= E, s = o - E + 1;
        } else break e;
        else {
          for (c = a = p[d], i = 1; a >= 10; a /= 10) i++;
          o %= E, s = o - E + i, l = s < 0 ? 0 : c / U(10, i - s - 1) % 10 | 0;
        }
        if (n = n || r < 0 || p[d + 1] !== void 0 || (s < 0 ? c : c % U(10, i - s - 1)), u = t < 4 ? (l || n) && (t == 0 || t == (e.s < 0 ? 3 : 2)) : l > 5 || l == 5 && (t == 4 || n || t == 6 && (o > 0 ? s > 0 ? c / U(10, i - s) : 0 : p[d - 1]) % 10 & 1 || t == (e.s < 0 ? 8 : 7)), r < 1 || !p[0]) return p.length = 0, u ? (r -= e.e + 1, p[0] = U(10, (E - r % E) % E), e.e = -r || 0) : p[0] = e.e = 0, e;
        if (o == 0 ? (p.length = d, a = 1, d--) : (p.length = d + 1, a = U(10, E - o), p[d] = s > 0 ? (c / U(10, i - s) % U(10, s) | 0) * a : 0), u) for (; ; ) if (d == 0) {
          for (o = 1, s = p[0]; s >= 10; s /= 10) o++;
          for (s = p[0] += a, a = 1; s >= 10; s /= 10) a++;
          o != a && (e.e++, p[0] == fe && (p[0] = 1));
          break;
        } else {
          if (p[d] += a, p[d] != fe) break;
          p[d--] = 0, a = 1;
        }
        for (o = p.length; p[--o] === 0; ) p.pop();
      }
      return w && (e.e > f.maxE ? (e.d = null, e.e = NaN) : e.e < f.minE && (e.e = 0, e.d = [0])), e;
    }
    function ve(e, r, t) {
      if (!e.isFinite()) return Ws(e);
      var n, i = e.e, o = J(e.d), s = o.length;
      return r ? (t && (n = t - s) > 0 ? o = o.charAt(0) + "." + o.slice(1) + Je(n) : s > 1 && (o = o.charAt(0) + "." + o.slice(1)), o = o + (e.e < 0 ? "e" : "e+") + e.e) : i < 0 ? (o = "0." + Je(-i - 1) + o, t && (n = t - s) > 0 && (o += Je(n))) : i >= s ? (o += Je(i + 1 - s), t && (n = t - i - 1) > 0 && (o = o + "." + Je(n))) : ((n = i + 1) < s && (o = o.slice(0, n) + "." + o.slice(n)), t && (n = t - s) > 0 && (i + 1 === s && (o += "."), o += Je(n))), o;
    }
    function wn(e, r) {
      var t = e[0];
      for (r *= E; t >= 10; t /= 10) r++;
      return r;
    }
    function bn(e, r, t) {
      if (r > vp) throw w = true, t && (e.precision = t), Error(qs);
      return y(new e(hn), r, 1, true);
    }
    function xe(e, r, t) {
      if (r > Qi) throw Error(qs);
      return y(new e(yn), r, t, true);
    }
    function Us(e) {
      var r = e.length - 1, t = r * E + 1;
      if (r = e[r], r) {
        for (; r % 10 == 0; r /= 10) t--;
        for (r = e[0]; r >= 10; r /= 10) t++;
      }
      return t;
    }
    function Je(e) {
      for (var r = ""; e--; ) r += "0";
      return r;
    }
    function Gs(e, r, t, n) {
      var i, o = new e(1), s = Math.ceil(n / E + 4);
      for (w = false; ; ) {
        if (t % 2 && (o = o.times(r), Fs(o.d, s) && (i = true)), t = X(t / 2), t === 0) {
          t = o.d.length - 1, i && o.d[t] === 0 && ++o.d[t];
          break;
        }
        r = r.times(r), Fs(r.d, s);
      }
      return w = true, o;
    }
    function Ls(e) {
      return e.d[e.d.length - 1] & 1;
    }
    function Qs(e, r, t) {
      for (var n, i, o = new e(r[0]), s = 0; ++s < r.length; ) {
        if (i = new e(r[s]), !i.s) {
          o = i;
          break;
        }
        n = o.cmp(i), (n === t || n === 0 && o.s === t) && (o = i);
      }
      return o;
    }
    function Wi(e, r) {
      var t, n, i, o, s, a, l, u = 0, c = 0, p = 0, d = e.constructor, f = d.rounding, h = d.precision;
      if (!e.d || !e.d[0] || e.e > 17) return new d(e.d ? e.d[0] ? e.s < 0 ? 0 : 1 / 0 : 1 : e.s ? e.s < 0 ? 0 : e : NaN);
      for (r == null ? (w = false, l = h) : l = r, a = new d(0.03125); e.e > -2; ) e = e.times(a), p += 5;
      for (n = Math.log(U(2, p)) / Math.LN10 * 2 + 5 | 0, l += n, t = o = s = new d(1), d.precision = l; ; ) {
        if (o = y(o.times(e), l, 1), t = t.times(++c), a = s.plus(L(o, t, l, 1)), J(a.d).slice(0, l) === J(s.d).slice(0, l)) {
          for (i = p; i--; ) s = y(s.times(s), l, 1);
          if (r == null) if (u < 3 && ut(s.d, l - n, f, u)) d.precision = l += 10, t = o = a = new d(1), c = 0, u++;
          else return y(s, d.precision = h, f, w = true);
          else return d.precision = h, s;
        }
        s = a;
      }
    }
    function Ke(e, r) {
      var t, n, i, o, s, a, l, u, c, p, d, f = 1, h = 10, g = e, I = g.d, T = g.constructor, S = T.rounding, b = T.precision;
      if (g.s < 0 || !I || !I[0] || !g.e && I[0] == 1 && I.length == 1) return new T(I && !I[0] ? -1 / 0 : g.s != 1 ? NaN : I ? 0 : g);
      if (r == null ? (w = false, c = b) : c = r, T.precision = c += h, t = J(I), n = t.charAt(0), Math.abs(o = g.e) < 15e14) {
        for (; n < 7 && n != 1 || n == 1 && t.charAt(1) > 3; ) g = g.times(e), t = J(g.d), n = t.charAt(0), f++;
        o = g.e, n > 1 ? (g = new T("0." + t), o++) : g = new T(n + "." + t.slice(1));
      } else return u = bn(T, c + 2, b).times(o + ""), g = Ke(new T(n + "." + t.slice(1)), c - h).plus(u), T.precision = b, r == null ? y(g, b, S, w = true) : g;
      for (p = g, l = s = g = L(g.minus(1), g.plus(1), c, 1), d = y(g.times(g), c, 1), i = 3; ; ) {
        if (s = y(s.times(d), c, 1), u = l.plus(L(s, new T(i), c, 1)), J(u.d).slice(0, c) === J(l.d).slice(0, c)) if (l = l.times(2), o !== 0 && (l = l.plus(bn(T, c + 2, b).times(o + ""))), l = L(l, new T(f), c, 1), r == null) if (ut(l.d, c - h, S, a)) T.precision = c += h, u = s = g = L(p.minus(1), p.plus(1), c, 1), d = y(g.times(g), c, 1), i = a = 1;
        else return y(l, T.precision = b, S, w = true);
        else return T.precision = b, l;
        l = u, i += 2;
      }
    }
    function Ws(e) {
      return String(e.s * e.s / 0);
    }
    function gn(e, r) {
      var t, n, i;
      for ((t = r.indexOf(".")) > -1 && (r = r.replace(".", "")), (n = r.search(/e/i)) > 0 ? (t < 0 && (t = n), t += +r.slice(n + 1), r = r.substring(0, n)) : t < 0 && (t = r.length), n = 0; r.charCodeAt(n) === 48; n++) ;
      for (i = r.length; r.charCodeAt(i - 1) === 48; --i) ;
      if (r = r.slice(n, i), r) {
        if (i -= n, e.e = t = t - n - 1, e.d = [], n = (t + 1) % E, t < 0 && (n += E), n < i) {
          for (n && e.d.push(+r.slice(0, n)), i -= E; n < i; ) e.d.push(+r.slice(n, n += E));
          r = r.slice(n), n = E - r.length;
        } else n -= i;
        for (; n--; ) r += "0";
        e.d.push(+r), w && (e.e > e.constructor.maxE ? (e.d = null, e.e = NaN) : e.e < e.constructor.minE && (e.e = 0, e.d = [0]));
      } else e.e = 0, e.d = [0];
      return e;
    }
    function Tp(e, r) {
      var t, n, i, o, s, a, l, u, c;
      if (r.indexOf("_") > -1) {
        if (r = r.replace(/(\d)_(?=\d)/g, "$1"), Bs.test(r)) return gn(e, r);
      } else if (r === "Infinity" || r === "NaN") return +r || (e.s = NaN), e.e = NaN, e.d = null, e;
      if (Ep.test(r)) t = 16, r = r.toLowerCase();
      else if (bp.test(r)) t = 2;
      else if (wp.test(r)) t = 8;
      else throw Error(He + r);
      for (o = r.search(/p/i), o > 0 ? (l = +r.slice(o + 1), r = r.substring(2, o)) : r = r.slice(2), o = r.indexOf("."), s = o >= 0, n = e.constructor, s && (r = r.replace(".", ""), a = r.length, o = a - o, i = Gs(n, new n(t), o, o * 2)), u = fn(r, t, fe), c = u.length - 1, o = c; u[o] === 0; --o) u.pop();
      return o < 0 ? new n(e.s * 0) : (e.e = wn(u, c), e.d = u, w = false, s && (e = L(e, i, a * 4)), l && (e = e.times(Math.abs(l) < 54 ? U(2, l) : Le.pow(2, l))), w = true, e);
    }
    function Sp(e, r) {
      var t, n = r.d.length;
      if (n < 3) return r.isZero() ? r : Tr(e, 2, r, r);
      t = 1.4 * Math.sqrt(n), t = t > 16 ? 16 : t | 0, r = r.times(1 / xn(5, t)), r = Tr(e, 2, r, r);
      for (var i, o = new e(5), s = new e(16), a = new e(20); t--; ) i = r.times(r), r = r.times(o.plus(i.times(s.times(i).minus(a))));
      return r;
    }
    function Tr(e, r, t, n, i) {
      var o, s, a, l, u = 1, c = e.precision, p = Math.ceil(c / E);
      for (w = false, l = t.times(t), a = new e(n); ; ) {
        if (s = L(a.times(l), new e(r++ * r++), c, 1), a = i ? n.plus(s) : n.minus(s), n = L(s.times(l), new e(r++ * r++), c, 1), s = a.plus(n), s.d[p] !== void 0) {
          for (o = p; s.d[o] === a.d[o] && o--; ) ;
          if (o == -1) break;
        }
        o = a, a = n, n = s, s = o, u++;
      }
      return w = true, s.d.length = p + 1, s;
    }
    function xn(e, r) {
      for (var t = e; --r; ) t *= e;
      return t;
    }
    function Js(e, r) {
      var t, n = r.s < 0, i = xe(e, e.precision, 1), o = i.times(0.5);
      if (r = r.abs(), r.lte(o)) return Ne = n ? 4 : 1, r;
      if (t = r.divToInt(i), t.isZero()) Ne = n ? 3 : 2;
      else {
        if (r = r.minus(t.times(i)), r.lte(o)) return Ne = Ls(t) ? n ? 2 : 3 : n ? 4 : 1, r;
        Ne = Ls(t) ? n ? 1 : 4 : n ? 3 : 2;
      }
      return r.minus(i).abs();
    }
    function Ji(e, r, t, n) {
      var i, o, s, a, l, u, c, p, d, f = e.constructor, h = t !== void 0;
      if (h ? (ne(t, 1, Ye), n === void 0 ? n = f.rounding : ne(n, 0, 8)) : (t = f.precision, n = f.rounding), !e.isFinite()) c = Ws(e);
      else {
        for (c = ve(e), s = c.indexOf("."), h ? (i = 2, r == 16 ? t = t * 4 - 3 : r == 8 && (t = t * 3 - 2)) : i = r, s >= 0 && (c = c.replace(".", ""), d = new f(1), d.e = c.length - s, d.d = fn(ve(d), 10, i), d.e = d.d.length), p = fn(c, 10, i), o = l = p.length; p[--l] == 0; ) p.pop();
        if (!p[0]) c = h ? "0p+0" : "0";
        else {
          if (s < 0 ? o-- : (e = new f(e), e.d = p, e.e = o, e = L(e, d, t, n, 0, i), p = e.d, o = e.e, u = $s), s = p[t], a = i / 2, u = u || p[t + 1] !== void 0, u = n < 4 ? (s !== void 0 || u) && (n === 0 || n === (e.s < 0 ? 3 : 2)) : s > a || s === a && (n === 4 || u || n === 6 && p[t - 1] & 1 || n === (e.s < 0 ? 8 : 7)), p.length = t, u) for (; ++p[--t] > i - 1; ) p[t] = 0, t || (++o, p.unshift(1));
          for (l = p.length; !p[l - 1]; --l) ;
          for (s = 0, c = ""; s < l; s++) c += Ui.charAt(p[s]);
          if (h) {
            if (l > 1) if (r == 16 || r == 8) {
              for (s = r == 16 ? 4 : 3, --l; l % s; l++) c += "0";
              for (p = fn(c, i, r), l = p.length; !p[l - 1]; --l) ;
              for (s = 1, c = "1."; s < l; s++) c += Ui.charAt(p[s]);
            } else c = c.charAt(0) + "." + c.slice(1);
            c = c + (o < 0 ? "p" : "p+") + o;
          } else if (o < 0) {
            for (; ++o; ) c = "0" + c;
            c = "0." + c;
          } else if (++o > l) for (o -= l; o--; ) c += "0";
          else o < l && (c = c.slice(0, o) + "." + c.slice(o));
        }
        c = (r == 16 ? "0x" : r == 2 ? "0b" : r == 8 ? "0o" : "") + c;
      }
      return e.s < 0 ? "-" + c : c;
    }
    function Fs(e, r) {
      if (e.length > r) return e.length = r, true;
    }
    function Rp(e) {
      return new this(e).abs();
    }
    function Ap(e) {
      return new this(e).acos();
    }
    function Cp(e) {
      return new this(e).acosh();
    }
    function Ip(e, r) {
      return new this(e).plus(r);
    }
    function Dp(e) {
      return new this(e).asin();
    }
    function Op(e) {
      return new this(e).asinh();
    }
    function kp(e) {
      return new this(e).atan();
    }
    function _p(e) {
      return new this(e).atanh();
    }
    function Np(e, r) {
      e = new this(e), r = new this(r);
      var t, n = this.precision, i = this.rounding, o = n + 4;
      return !e.s || !r.s ? t = new this(NaN) : !e.d && !r.d ? (t = xe(this, o, 1).times(r.s > 0 ? 0.25 : 0.75), t.s = e.s) : !r.d || e.isZero() ? (t = r.s < 0 ? xe(this, n, i) : new this(0), t.s = e.s) : !e.d || r.isZero() ? (t = xe(this, o, 1).times(0.5), t.s = e.s) : r.s < 0 ? (this.precision = o, this.rounding = 1, t = this.atan(L(e, r, o, 1)), r = xe(this, o, 1), this.precision = n, this.rounding = i, t = e.s < 0 ? t.minus(r) : t.plus(r)) : t = this.atan(L(e, r, o, 1)), t;
    }
    function Lp(e) {
      return new this(e).cbrt();
    }
    function Fp(e) {
      return y(e = new this(e), e.e + 1, 2);
    }
    function Mp(e, r, t) {
      return new this(e).clamp(r, t);
    }
    function $p(e) {
      if (!e || typeof e != "object") throw Error(En + "Object expected");
      var r, t, n, i = e.defaults === true, o = ["precision", 1, Ye, "rounding", 0, 8, "toExpNeg", -Pr, 0, "toExpPos", 0, Pr, "maxE", 0, Pr, "minE", -Pr, 0, "modulo", 0, 9];
      for (r = 0; r < o.length; r += 3) if (t = o[r], i && (this[t] = Gi[t]), (n = e[t]) !== void 0) if (X(n) === n && n >= o[r + 1] && n <= o[r + 2]) this[t] = n;
      else throw Error(He + t + ": " + n);
      if (t = "crypto", i && (this[t] = Gi[t]), (n = e[t]) !== void 0) if (n === true || n === false || n === 0 || n === 1) if (n) if (typeof crypto < "u" && crypto && (crypto.getRandomValues || crypto.randomBytes)) this[t] = true;
      else throw Error(Vs);
      else this[t] = false;
      else throw Error(He + t + ": " + n);
      return this;
    }
    function qp(e) {
      return new this(e).cos();
    }
    function Vp(e) {
      return new this(e).cosh();
    }
    function Ks(e) {
      var r, t, n;
      function i(o) {
        var s, a, l, u = this;
        if (!(u instanceof i)) return new i(o);
        if (u.constructor = i, Ms(o)) {
          u.s = o.s, w ? !o.d || o.e > i.maxE ? (u.e = NaN, u.d = null) : o.e < i.minE ? (u.e = 0, u.d = [0]) : (u.e = o.e, u.d = o.d.slice()) : (u.e = o.e, u.d = o.d ? o.d.slice() : o.d);
          return;
        }
        if (l = typeof o, l === "number") {
          if (o === 0) {
            u.s = 1 / o < 0 ? -1 : 1, u.e = 0, u.d = [0];
            return;
          }
          if (o < 0 ? (o = -o, u.s = -1) : u.s = 1, o === ~~o && o < 1e7) {
            for (s = 0, a = o; a >= 10; a /= 10) s++;
            w ? s > i.maxE ? (u.e = NaN, u.d = null) : s < i.minE ? (u.e = 0, u.d = [0]) : (u.e = s, u.d = [o]) : (u.e = s, u.d = [o]);
            return;
          }
          if (o * 0 !== 0) {
            o || (u.s = NaN), u.e = NaN, u.d = null;
            return;
          }
          return gn(u, o.toString());
        }
        if (l === "string") return (a = o.charCodeAt(0)) === 45 ? (o = o.slice(1), u.s = -1) : (a === 43 && (o = o.slice(1)), u.s = 1), Bs.test(o) ? gn(u, o) : Tp(u, o);
        if (l === "bigint") return o < 0 ? (o = -o, u.s = -1) : u.s = 1, gn(u, o.toString());
        throw Error(He + o);
      }
      if (i.prototype = m, i.ROUND_UP = 0, i.ROUND_DOWN = 1, i.ROUND_CEIL = 2, i.ROUND_FLOOR = 3, i.ROUND_HALF_UP = 4, i.ROUND_HALF_DOWN = 5, i.ROUND_HALF_EVEN = 6, i.ROUND_HALF_CEIL = 7, i.ROUND_HALF_FLOOR = 8, i.EUCLID = 9, i.config = i.set = $p, i.clone = Ks, i.isDecimal = Ms, i.abs = Rp, i.acos = Ap, i.acosh = Cp, i.add = Ip, i.asin = Dp, i.asinh = Op, i.atan = kp, i.atanh = _p, i.atan2 = Np, i.cbrt = Lp, i.ceil = Fp, i.clamp = Mp, i.cos = qp, i.cosh = Vp, i.div = jp, i.exp = Bp, i.floor = Up, i.hypot = Gp, i.ln = Qp, i.log = Wp, i.log10 = Kp, i.log2 = Jp, i.max = Hp, i.min = Yp, i.mod = zp, i.mul = Zp, i.pow = Xp, i.random = ed, i.round = rd, i.sign = td, i.sin = nd, i.sinh = id, i.sqrt = od, i.sub = sd, i.sum = ad, i.tan = ld, i.tanh = ud, i.trunc = cd, e === void 0 && (e = {}), e && e.defaults !== true) for (n = ["precision", "rounding", "toExpNeg", "toExpPos", "maxE", "minE", "modulo", "crypto"], r = 0; r < n.length; ) e.hasOwnProperty(t = n[r++]) || (e[t] = this[t]);
      return i.config(e), i;
    }
    function jp(e, r) {
      return new this(e).div(r);
    }
    function Bp(e) {
      return new this(e).exp();
    }
    function Up(e) {
      return y(e = new this(e), e.e + 1, 3);
    }
    function Gp() {
      var e, r, t = new this(0);
      for (w = false, e = 0; e < arguments.length; ) if (r = new this(arguments[e++]), r.d) t.d && (t = t.plus(r.times(r)));
      else {
        if (r.s) return w = true, new this(1 / 0);
        t = r;
      }
      return w = true, t.sqrt();
    }
    function Ms(e) {
      return e instanceof Le || e && e.toStringTag === js || false;
    }
    function Qp(e) {
      return new this(e).ln();
    }
    function Wp(e, r) {
      return new this(e).log(r);
    }
    function Jp(e) {
      return new this(e).log(2);
    }
    function Kp(e) {
      return new this(e).log(10);
    }
    function Hp() {
      return Qs(this, arguments, -1);
    }
    function Yp() {
      return Qs(this, arguments, 1);
    }
    function zp(e, r) {
      return new this(e).mod(r);
    }
    function Zp(e, r) {
      return new this(e).mul(r);
    }
    function Xp(e, r) {
      return new this(e).pow(r);
    }
    function ed(e) {
      var r, t, n, i, o = 0, s = new this(1), a = [];
      if (e === void 0 ? e = this.precision : ne(e, 1, Ye), n = Math.ceil(e / E), this.crypto) if (crypto.getRandomValues) for (r = crypto.getRandomValues(new Uint32Array(n)); o < n; ) i = r[o], i >= 429e7 ? r[o] = crypto.getRandomValues(new Uint32Array(1))[0] : a[o++] = i % 1e7;
      else if (crypto.randomBytes) {
        for (r = crypto.randomBytes(n *= 4); o < n; ) i = r[o] + (r[o + 1] << 8) + (r[o + 2] << 16) + ((r[o + 3] & 127) << 24), i >= 214e7 ? crypto.randomBytes(4).copy(r, o) : (a.push(i % 1e7), o += 4);
        o = n / 4;
      } else throw Error(Vs);
      else for (; o < n; ) a[o++] = Math.random() * 1e7 | 0;
      for (n = a[--o], e %= E, n && e && (i = U(10, E - e), a[o] = (n / i | 0) * i); a[o] === 0; o--) a.pop();
      if (o < 0) t = 0, a = [0];
      else {
        for (t = -1; a[0] === 0; t -= E) a.shift();
        for (n = 1, i = a[0]; i >= 10; i /= 10) n++;
        n < E && (t -= E - n);
      }
      return s.e = t, s.d = a, s;
    }
    function rd(e) {
      return y(e = new this(e), e.e + 1, this.rounding);
    }
    function td(e) {
      return e = new this(e), e.d ? e.d[0] ? e.s : 0 * e.s : e.s || NaN;
    }
    function nd(e) {
      return new this(e).sin();
    }
    function id(e) {
      return new this(e).sinh();
    }
    function od(e) {
      return new this(e).sqrt();
    }
    function sd(e, r) {
      return new this(e).sub(r);
    }
    function ad() {
      var e = 0, r = arguments, t = new this(r[e]);
      for (w = false; t.s && ++e < r.length; ) t = t.plus(r[e]);
      return w = true, y(t, this.precision, this.rounding);
    }
    function ld(e) {
      return new this(e).tan();
    }
    function ud(e) {
      return new this(e).tanh();
    }
    function cd(e) {
      return y(e = new this(e), e.e + 1, 1);
    }
    m[Symbol.for("nodejs.util.inspect.custom")] = m.toString;
    m[Symbol.toStringTag] = "Decimal";
    var Le = m.constructor = Ks(Gi);
    hn = new Le(hn);
    yn = new Le(yn);
    var Fe = Le;
    function Sr(e) {
      return Le.isDecimal(e) ? true : e !== null && typeof e == "object" && typeof e.s == "number" && typeof e.e == "number" && typeof e.toFixed == "function" && Array.isArray(e.d);
    }
    var ct = {};
    tr(ct, { ModelAction: () => Rr, datamodelEnumToSchemaEnum: () => pd });
    function pd(e) {
      return { name: e.name, values: e.values.map((r) => r.name) };
    }
    var Rr = ((b) => (b.findUnique = "findUnique", b.findUniqueOrThrow = "findUniqueOrThrow", b.findFirst = "findFirst", b.findFirstOrThrow = "findFirstOrThrow", b.findMany = "findMany", b.create = "create", b.createMany = "createMany", b.createManyAndReturn = "createManyAndReturn", b.update = "update", b.updateMany = "updateMany", b.updateManyAndReturn = "updateManyAndReturn", b.upsert = "upsert", b.delete = "delete", b.deleteMany = "deleteMany", b.groupBy = "groupBy", b.count = "count", b.aggregate = "aggregate", b.findRaw = "findRaw", b.aggregateRaw = "aggregateRaw", b))(Rr || {});
    var Xs = O(Di());
    var Zs = O(require("node:fs"));
    var Hs = { keyword: De, entity: De, value: (e) => W(nr(e)), punctuation: nr, directive: De, function: De, variable: (e) => W(nr(e)), string: (e) => W(qe(e)), boolean: Ie, number: De, comment: Hr };
    var dd = (e) => e;
    var vn = {};
    var md = 0;
    var v = { manual: vn.Prism && vn.Prism.manual, disableWorkerMessageHandler: vn.Prism && vn.Prism.disableWorkerMessageHandler, util: { encode: function(e) {
      if (e instanceof ge) {
        let r = e;
        return new ge(r.type, v.util.encode(r.content), r.alias);
      } else return Array.isArray(e) ? e.map(v.util.encode) : e.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\u00a0/g, " ");
    }, type: function(e) {
      return Object.prototype.toString.call(e).slice(8, -1);
    }, objId: function(e) {
      return e.__id || Object.defineProperty(e, "__id", { value: ++md }), e.__id;
    }, clone: function e(r, t) {
      let n, i, o = v.util.type(r);
      switch (t = t || {}, o) {
        case "Object":
          if (i = v.util.objId(r), t[i]) return t[i];
          n = {}, t[i] = n;
          for (let s in r) r.hasOwnProperty(s) && (n[s] = e(r[s], t));
          return n;
        case "Array":
          return i = v.util.objId(r), t[i] ? t[i] : (n = [], t[i] = n, r.forEach(function(s, a) {
            n[a] = e(s, t);
          }), n);
        default:
          return r;
      }
    } }, languages: { extend: function(e, r) {
      let t = v.util.clone(v.languages[e]);
      for (let n in r) t[n] = r[n];
      return t;
    }, insertBefore: function(e, r, t, n) {
      n = n || v.languages;
      let i = n[e], o = {};
      for (let a in i) if (i.hasOwnProperty(a)) {
        if (a == r) for (let l in t) t.hasOwnProperty(l) && (o[l] = t[l]);
        t.hasOwnProperty(a) || (o[a] = i[a]);
      }
      let s = n[e];
      return n[e] = o, v.languages.DFS(v.languages, function(a, l) {
        l === s && a != e && (this[a] = o);
      }), o;
    }, DFS: function e(r, t, n, i) {
      i = i || {};
      let o = v.util.objId;
      for (let s in r) if (r.hasOwnProperty(s)) {
        t.call(r, s, r[s], n || s);
        let a = r[s], l = v.util.type(a);
        l === "Object" && !i[o(a)] ? (i[o(a)] = true, e(a, t, null, i)) : l === "Array" && !i[o(a)] && (i[o(a)] = true, e(a, t, s, i));
      }
    } }, plugins: {}, highlight: function(e, r, t) {
      let n = { code: e, grammar: r, language: t };
      return v.hooks.run("before-tokenize", n), n.tokens = v.tokenize(n.code, n.grammar), v.hooks.run("after-tokenize", n), ge.stringify(v.util.encode(n.tokens), n.language);
    }, matchGrammar: function(e, r, t, n, i, o, s) {
      for (let g in t) {
        if (!t.hasOwnProperty(g) || !t[g]) continue;
        if (g == s) return;
        let I = t[g];
        I = v.util.type(I) === "Array" ? I : [I];
        for (let T = 0; T < I.length; ++T) {
          let S = I[T], b = S.inside, D = !!S.lookbehind, me = !!S.greedy, se = 0, Kr = S.alias;
          if (me && !S.pattern.global) {
            let j = S.pattern.toString().match(/[imuy]*$/)[0];
            S.pattern = RegExp(S.pattern.source, j + "g");
          }
          S = S.pattern || S;
          for (let j = n, te = i; j < r.length; te += r[j].length, ++j) {
            let Ae = r[j];
            if (r.length > e.length) return;
            if (Ae instanceof ge) continue;
            if (me && j != r.length - 1) {
              S.lastIndex = te;
              var p = S.exec(e);
              if (!p) break;
              var c = p.index + (D ? p[1].length : 0), d = p.index + p[0].length, a = j, l = te;
              for (let k = r.length; a < k && (l < d || !r[a].type && !r[a - 1].greedy); ++a) l += r[a].length, c >= l && (++j, te = l);
              if (r[j] instanceof ge) continue;
              u = a - j, Ae = e.slice(te, l), p.index -= te;
            } else {
              S.lastIndex = 0;
              var p = S.exec(Ae), u = 1;
            }
            if (!p) {
              if (o) break;
              continue;
            }
            D && (se = p[1] ? p[1].length : 0);
            var c = p.index + se, p = p[0].slice(se), d = c + p.length, f = Ae.slice(0, c), h = Ae.slice(d);
            let K = [j, u];
            f && (++j, te += f.length, K.push(f));
            let fr = new ge(g, b ? v.tokenize(p, b) : p, Kr, p, me);
            if (K.push(fr), h && K.push(h), Array.prototype.splice.apply(r, K), u != 1 && v.matchGrammar(e, r, t, j, te, true, g), o) break;
          }
        }
      }
    }, tokenize: function(e, r) {
      let t = [e], n = r.rest;
      if (n) {
        for (let i in n) r[i] = n[i];
        delete r.rest;
      }
      return v.matchGrammar(e, t, r, 0, 0, false), t;
    }, hooks: { all: {}, add: function(e, r) {
      let t = v.hooks.all;
      t[e] = t[e] || [], t[e].push(r);
    }, run: function(e, r) {
      let t = v.hooks.all[e];
      if (!(!t || !t.length)) for (var n = 0, i; i = t[n++]; ) i(r);
    } }, Token: ge };
    v.languages.clike = { comment: [{ pattern: /(^|[^\\])\/\*[\s\S]*?(?:\*\/|$)/, lookbehind: true }, { pattern: /(^|[^\\:])\/\/.*/, lookbehind: true, greedy: true }], string: { pattern: /(["'])(?:\\(?:\r\n|[\s\S])|(?!\1)[^\\\r\n])*\1/, greedy: true }, "class-name": { pattern: /((?:\b(?:class|interface|extends|implements|trait|instanceof|new)\s+)|(?:catch\s+\())[\w.\\]+/i, lookbehind: true, inside: { punctuation: /[.\\]/ } }, keyword: /\b(?:if|else|while|do|for|return|in|instanceof|function|new|try|throw|catch|finally|null|break|continue)\b/, boolean: /\b(?:true|false)\b/, function: /\w+(?=\()/, number: /\b0x[\da-f]+\b|(?:\b\d+\.?\d*|\B\.\d+)(?:e[+-]?\d+)?/i, operator: /--?|\+\+?|!=?=?|<=?|>=?|==?=?|&&?|\|\|?|\?|\*|\/|~|\^|%/, punctuation: /[{}[\];(),.:]/ };
    v.languages.javascript = v.languages.extend("clike", { "class-name": [v.languages.clike["class-name"], { pattern: /(^|[^$\w\xA0-\uFFFF])[_$A-Z\xA0-\uFFFF][$\w\xA0-\uFFFF]*(?=\.(?:prototype|constructor))/, lookbehind: true }], keyword: [{ pattern: /((?:^|})\s*)(?:catch|finally)\b/, lookbehind: true }, { pattern: /(^|[^.])\b(?:as|async(?=\s*(?:function\b|\(|[$\w\xA0-\uFFFF]|$))|await|break|case|class|const|continue|debugger|default|delete|do|else|enum|export|extends|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|null|of|package|private|protected|public|return|set|static|super|switch|this|throw|try|typeof|undefined|var|void|while|with|yield)\b/, lookbehind: true }], number: /\b(?:(?:0[xX](?:[\dA-Fa-f](?:_[\dA-Fa-f])?)+|0[bB](?:[01](?:_[01])?)+|0[oO](?:[0-7](?:_[0-7])?)+)n?|(?:\d(?:_\d)?)+n|NaN|Infinity)\b|(?:\b(?:\d(?:_\d)?)+\.?(?:\d(?:_\d)?)*|\B\.(?:\d(?:_\d)?)+)(?:[Ee][+-]?(?:\d(?:_\d)?)+)?/, function: /[_$a-zA-Z\xA0-\uFFFF][$\w\xA0-\uFFFF]*(?=\s*(?:\.\s*(?:apply|bind|call)\s*)?\()/, operator: /-[-=]?|\+[+=]?|!=?=?|<<?=?|>>?>?=?|=(?:==?|>)?|&[&=]?|\|[|=]?|\*\*?=?|\/=?|~|\^=?|%=?|\?|\.{3}/ });
    v.languages.javascript["class-name"][0].pattern = /(\b(?:class|interface|extends|implements|instanceof|new)\s+)[\w.\\]+/;
    v.languages.insertBefore("javascript", "keyword", { regex: { pattern: /((?:^|[^$\w\xA0-\uFFFF."'\])\s])\s*)\/(\[(?:[^\]\\\r\n]|\\.)*]|\\.|[^/\\\[\r\n])+\/[gimyus]{0,6}(?=\s*($|[\r\n,.;})\]]))/, lookbehind: true, greedy: true }, "function-variable": { pattern: /[_$a-zA-Z\xA0-\uFFFF][$\w\xA0-\uFFFF]*(?=\s*[=:]\s*(?:async\s*)?(?:\bfunction\b|(?:\((?:[^()]|\([^()]*\))*\)|[_$a-zA-Z\xA0-\uFFFF][$\w\xA0-\uFFFF]*)\s*=>))/, alias: "function" }, parameter: [{ pattern: /(function(?:\s+[_$A-Za-z\xA0-\uFFFF][$\w\xA0-\uFFFF]*)?\s*\(\s*)(?!\s)(?:[^()]|\([^()]*\))+?(?=\s*\))/, lookbehind: true, inside: v.languages.javascript }, { pattern: /[_$a-z\xA0-\uFFFF][$\w\xA0-\uFFFF]*(?=\s*=>)/i, inside: v.languages.javascript }, { pattern: /(\(\s*)(?!\s)(?:[^()]|\([^()]*\))+?(?=\s*\)\s*=>)/, lookbehind: true, inside: v.languages.javascript }, { pattern: /((?:\b|\s|^)(?!(?:as|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|null|of|package|private|protected|public|return|set|static|super|switch|this|throw|try|typeof|undefined|var|void|while|with|yield)(?![$\w\xA0-\uFFFF]))(?:[_$A-Za-z\xA0-\uFFFF][$\w\xA0-\uFFFF]*\s*)\(\s*)(?!\s)(?:[^()]|\([^()]*\))+?(?=\s*\)\s*\{)/, lookbehind: true, inside: v.languages.javascript }], constant: /\b[A-Z](?:[A-Z_]|\dx?)*\b/ });
    v.languages.markup && v.languages.markup.tag.addInlined("script", "javascript");
    v.languages.js = v.languages.javascript;
    v.languages.typescript = v.languages.extend("javascript", { keyword: /\b(?:abstract|as|async|await|break|case|catch|class|const|constructor|continue|debugger|declare|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|is|keyof|let|module|namespace|new|null|of|package|private|protected|public|readonly|return|require|set|static|super|switch|this|throw|try|type|typeof|var|void|while|with|yield)\b/, builtin: /\b(?:string|Function|any|number|boolean|Array|symbol|console|Promise|unknown|never)\b/ });
    v.languages.ts = v.languages.typescript;
    function ge(e, r, t, n, i) {
      this.type = e, this.content = r, this.alias = t, this.length = (n || "").length | 0, this.greedy = !!i;
    }
    ge.stringify = function(e, r) {
      return typeof e == "string" ? e : Array.isArray(e) ? e.map(function(t) {
        return ge.stringify(t, r);
      }).join("") : fd(e.type)(e.content);
    };
    function fd(e) {
      return Hs[e] || dd;
    }
    function Ys(e) {
      return gd(e, v.languages.javascript);
    }
    function gd(e, r) {
      return v.tokenize(e, r).map((n) => ge.stringify(n)).join("");
    }
    function zs(e) {
      return Ci(e);
    }
    var Pn = class e {
      firstLineNumber;
      lines;
      static read(r) {
        let t;
        try {
          t = Zs.default.readFileSync(r, "utf-8");
        } catch {
          return null;
        }
        return e.fromContent(t);
      }
      static fromContent(r) {
        let t = r.split(/\r?\n/);
        return new e(1, t);
      }
      constructor(r, t) {
        this.firstLineNumber = r, this.lines = t;
      }
      get lastLineNumber() {
        return this.firstLineNumber + this.lines.length - 1;
      }
      mapLineAt(r, t) {
        if (r < this.firstLineNumber || r > this.lines.length + this.firstLineNumber) return this;
        let n = r - this.firstLineNumber, i = [...this.lines];
        return i[n] = t(i[n]), new e(this.firstLineNumber, i);
      }
      mapLines(r) {
        return new e(this.firstLineNumber, this.lines.map((t, n) => r(t, this.firstLineNumber + n)));
      }
      lineAt(r) {
        return this.lines[r - this.firstLineNumber];
      }
      prependSymbolAt(r, t) {
        return this.mapLines((n, i) => i === r ? `${t} ${n}` : `  ${n}`);
      }
      slice(r, t) {
        let n = this.lines.slice(r - 1, t).join(`
`);
        return new e(r, zs(n).split(`
`));
      }
      highlight() {
        let r = Ys(this.toString());
        return new e(this.firstLineNumber, r.split(`
`));
      }
      toString() {
        return this.lines.join(`
`);
      }
    };
    var hd = { red: ce, gray: Hr, dim: Ce, bold: W, underline: Y, highlightSource: (e) => e.highlight() };
    var yd = { red: (e) => e, gray: (e) => e, dim: (e) => e, bold: (e) => e, underline: (e) => e, highlightSource: (e) => e };
    function bd({ message: e, originalMethod: r, isPanic: t, callArguments: n }) {
      return { functionName: `prisma.${r}()`, message: e, isPanic: t ?? false, callArguments: n };
    }
    function Ed({ callsite: e, message: r, originalMethod: t, isPanic: n, callArguments: i }, o) {
      let s = bd({ message: r, originalMethod: t, isPanic: n, callArguments: i });
      if (!e || typeof window < "u" || process.env.NODE_ENV === "production") return s;
      let a = e.getLocation();
      if (!a || !a.lineNumber || !a.columnNumber) return s;
      let l = Math.max(1, a.lineNumber - 3), u = Pn.read(a.fileName)?.slice(l, a.lineNumber), c = u?.lineAt(a.lineNumber);
      if (u && c) {
        let p = xd(c), d = wd(c);
        if (!d) return s;
        s.functionName = `${d.code})`, s.location = a, n || (u = u.mapLineAt(a.lineNumber, (h) => h.slice(0, d.openingBraceIndex))), u = o.highlightSource(u);
        let f = String(u.lastLineNumber).length;
        if (s.contextLines = u.mapLines((h, g) => o.gray(String(g).padStart(f)) + " " + h).mapLines((h) => o.dim(h)).prependSymbolAt(a.lineNumber, o.bold(o.red("\u2192"))), i) {
          let h = p + f + 1;
          h += 2, s.callArguments = (0, Xs.default)(i, h).slice(h);
        }
      }
      return s;
    }
    function wd(e) {
      let r = Object.keys(Rr).join("|"), n = new RegExp(String.raw`\.(${r})\(`).exec(e);
      if (n) {
        let i = n.index + n[0].length, o = e.lastIndexOf(" ", n.index) + 1;
        return { code: e.slice(o, i), openingBraceIndex: i };
      }
      return null;
    }
    function xd(e) {
      let r = 0;
      for (let t = 0; t < e.length; t++) {
        if (e.charAt(t) !== " ") return r;
        r++;
      }
      return r;
    }
    function vd({ functionName: e, location: r, message: t, isPanic: n, contextLines: i, callArguments: o }, s) {
      let a = [""], l = r ? " in" : ":";
      if (n ? (a.push(s.red(`Oops, an unknown error occurred! This is ${s.bold("on us")}, you did nothing wrong.`)), a.push(s.red(`It occurred in the ${s.bold(`\`${e}\``)} invocation${l}`))) : a.push(s.red(`Invalid ${s.bold(`\`${e}\``)} invocation${l}`)), r && a.push(s.underline(Pd(r))), i) {
        a.push("");
        let u = [i.toString()];
        o && (u.push(o), u.push(s.dim(")"))), a.push(u.join("")), o && a.push("");
      } else a.push(""), o && a.push(o), a.push("");
      return a.push(t), a.join(`
`);
    }
    function Pd(e) {
      let r = [e.fileName];
      return e.lineNumber && r.push(String(e.lineNumber)), e.columnNumber && r.push(String(e.columnNumber)), r.join(":");
    }
    function Tn(e) {
      let r = e.showColors ? hd : yd, t;
      return t = Ed(e, r), vd(t, r);
    }
    var la = O(Ki());
    function na(e, r, t) {
      let n = ia(e), i = Td(n), o = Rd(i);
      o ? Sn(o, r, t) : r.addErrorMessage(() => "Unknown error");
    }
    function ia(e) {
      return e.errors.flatMap((r) => r.kind === "Union" ? ia(r) : [r]);
    }
    function Td(e) {
      let r = /* @__PURE__ */ new Map(), t = [];
      for (let n of e) {
        if (n.kind !== "InvalidArgumentType") {
          t.push(n);
          continue;
        }
        let i = `${n.selectionPath.join(".")}:${n.argumentPath.join(".")}`, o = r.get(i);
        o ? r.set(i, { ...n, argument: { ...n.argument, typeNames: Sd(o.argument.typeNames, n.argument.typeNames) } }) : r.set(i, n);
      }
      return t.push(...r.values()), t;
    }
    function Sd(e, r) {
      return [...new Set(e.concat(r))];
    }
    function Rd(e) {
      return ji(e, (r, t) => {
        let n = ra(r), i = ra(t);
        return n !== i ? n - i : ta(r) - ta(t);
      });
    }
    function ra(e) {
      let r = 0;
      return Array.isArray(e.selectionPath) && (r += e.selectionPath.length), Array.isArray(e.argumentPath) && (r += e.argumentPath.length), r;
    }
    function ta(e) {
      switch (e.kind) {
        case "InvalidArgumentValue":
        case "ValueTooLarge":
          return 20;
        case "InvalidArgumentType":
          return 10;
        case "RequiredArgumentMissing":
          return -10;
        default:
          return 0;
      }
    }
    var le = class {
      constructor(r, t) {
        this.name = r;
        this.value = t;
      }
      isRequired = false;
      makeRequired() {
        return this.isRequired = true, this;
      }
      write(r) {
        let { colors: { green: t } } = r.context;
        r.addMarginSymbol(t(this.isRequired ? "+" : "?")), r.write(t(this.name)), this.isRequired || r.write(t("?")), r.write(t(": ")), typeof this.value == "string" ? r.write(t(this.value)) : r.write(this.value);
      }
    };
    sa();
    var Ar = class {
      constructor(r = 0, t) {
        this.context = t;
        this.currentIndent = r;
      }
      lines = [];
      currentLine = "";
      currentIndent = 0;
      marginSymbol;
      afterNextNewLineCallback;
      write(r) {
        return typeof r == "string" ? this.currentLine += r : r.write(this), this;
      }
      writeJoined(r, t, n = (i, o) => o.write(i)) {
        let i = t.length - 1;
        for (let o = 0; o < t.length; o++) n(t[o], this), o !== i && this.write(r);
        return this;
      }
      writeLine(r) {
        return this.write(r).newLine();
      }
      newLine() {
        this.lines.push(this.indentedCurrentLine()), this.currentLine = "", this.marginSymbol = void 0;
        let r = this.afterNextNewLineCallback;
        return this.afterNextNewLineCallback = void 0, r?.(), this;
      }
      withIndent(r) {
        return this.indent(), r(this), this.unindent(), this;
      }
      afterNextNewline(r) {
        return this.afterNextNewLineCallback = r, this;
      }
      indent() {
        return this.currentIndent++, this;
      }
      unindent() {
        return this.currentIndent > 0 && this.currentIndent--, this;
      }
      addMarginSymbol(r) {
        return this.marginSymbol = r, this;
      }
      toString() {
        return this.lines.concat(this.indentedCurrentLine()).join(`
`);
      }
      getCurrentLineLength() {
        return this.currentLine.length;
      }
      indentedCurrentLine() {
        let r = this.currentLine.padStart(this.currentLine.length + 2 * this.currentIndent);
        return this.marginSymbol ? this.marginSymbol + r.slice(1) : r;
      }
    };
    oa();
    var Rn = class {
      constructor(r) {
        this.value = r;
      }
      write(r) {
        r.write(this.value);
      }
      markAsError() {
        this.value.markAsError();
      }
    };
    var An = (e) => e;
    var Cn = { bold: An, red: An, green: An, dim: An, enabled: false };
    var aa = { bold: W, red: ce, green: qe, dim: Ce, enabled: true };
    var Cr = { write(e) {
      e.writeLine(",");
    } };
    var Pe = class {
      constructor(r) {
        this.contents = r;
      }
      isUnderlined = false;
      color = (r) => r;
      underline() {
        return this.isUnderlined = true, this;
      }
      setColor(r) {
        return this.color = r, this;
      }
      write(r) {
        let t = r.getCurrentLineLength();
        r.write(this.color(this.contents)), this.isUnderlined && r.afterNextNewline(() => {
          r.write(" ".repeat(t)).writeLine(this.color("~".repeat(this.contents.length)));
        });
      }
    };
    var ze = class {
      hasError = false;
      markAsError() {
        return this.hasError = true, this;
      }
    };
    var Ir = class extends ze {
      items = [];
      addItem(r) {
        return this.items.push(new Rn(r)), this;
      }
      getField(r) {
        return this.items[r];
      }
      getPrintWidth() {
        return this.items.length === 0 ? 2 : Math.max(...this.items.map((t) => t.value.getPrintWidth())) + 2;
      }
      write(r) {
        if (this.items.length === 0) {
          this.writeEmpty(r);
          return;
        }
        this.writeWithItems(r);
      }
      writeEmpty(r) {
        let t = new Pe("[]");
        this.hasError && t.setColor(r.context.colors.red).underline(), r.write(t);
      }
      writeWithItems(r) {
        let { colors: t } = r.context;
        r.writeLine("[").withIndent(() => r.writeJoined(Cr, this.items).newLine()).write("]"), this.hasError && r.afterNextNewline(() => {
          r.writeLine(t.red("~".repeat(this.getPrintWidth())));
        });
      }
      asObject() {
      }
    };
    var Dr = class e extends ze {
      fields = {};
      suggestions = [];
      addField(r) {
        this.fields[r.name] = r;
      }
      addSuggestion(r) {
        this.suggestions.push(r);
      }
      getField(r) {
        return this.fields[r];
      }
      getDeepField(r) {
        let [t, ...n] = r, i = this.getField(t);
        if (!i) return;
        let o = i;
        for (let s of n) {
          let a;
          if (o.value instanceof e ? a = o.value.getField(s) : o.value instanceof Ir && (a = o.value.getField(Number(s))), !a) return;
          o = a;
        }
        return o;
      }
      getDeepFieldValue(r) {
        return r.length === 0 ? this : this.getDeepField(r)?.value;
      }
      hasField(r) {
        return !!this.getField(r);
      }
      removeAllFields() {
        this.fields = {};
      }
      removeField(r) {
        delete this.fields[r];
      }
      getFields() {
        return this.fields;
      }
      isEmpty() {
        return Object.keys(this.fields).length === 0;
      }
      getFieldValue(r) {
        return this.getField(r)?.value;
      }
      getDeepSubSelectionValue(r) {
        let t = this;
        for (let n of r) {
          if (!(t instanceof e)) return;
          let i = t.getSubSelectionValue(n);
          if (!i) return;
          t = i;
        }
        return t;
      }
      getDeepSelectionParent(r) {
        let t = this.getSelectionParent();
        if (!t) return;
        let n = t;
        for (let i of r) {
          let o = n.value.getFieldValue(i);
          if (!o || !(o instanceof e)) return;
          let s = o.getSelectionParent();
          if (!s) return;
          n = s;
        }
        return n;
      }
      getSelectionParent() {
        let r = this.getField("select")?.value.asObject();
        if (r) return { kind: "select", value: r };
        let t = this.getField("include")?.value.asObject();
        if (t) return { kind: "include", value: t };
      }
      getSubSelectionValue(r) {
        return this.getSelectionParent()?.value.fields[r].value;
      }
      getPrintWidth() {
        let r = Object.values(this.fields);
        return r.length == 0 ? 2 : Math.max(...r.map((n) => n.getPrintWidth())) + 2;
      }
      write(r) {
        let t = Object.values(this.fields);
        if (t.length === 0 && this.suggestions.length === 0) {
          this.writeEmpty(r);
          return;
        }
        this.writeWithContents(r, t);
      }
      asObject() {
        return this;
      }
      writeEmpty(r) {
        let t = new Pe("{}");
        this.hasError && t.setColor(r.context.colors.red).underline(), r.write(t);
      }
      writeWithContents(r, t) {
        r.writeLine("{").withIndent(() => {
          r.writeJoined(Cr, [...t, ...this.suggestions]).newLine();
        }), r.write("}"), this.hasError && r.afterNextNewline(() => {
          r.writeLine(r.context.colors.red("~".repeat(this.getPrintWidth())));
        });
      }
    };
    var Q = class extends ze {
      constructor(t) {
        super();
        this.text = t;
      }
      getPrintWidth() {
        return this.text.length;
      }
      write(t) {
        let n = new Pe(this.text);
        this.hasError && n.underline().setColor(t.context.colors.red), t.write(n);
      }
      asObject() {
      }
    };
    var pt = class {
      fields = [];
      addField(r, t) {
        return this.fields.push({ write(n) {
          let { green: i, dim: o } = n.context.colors;
          n.write(i(o(`${r}: ${t}`))).addMarginSymbol(i(o("+")));
        } }), this;
      }
      write(r) {
        let { colors: { green: t } } = r.context;
        r.writeLine(t("{")).withIndent(() => {
          r.writeJoined(Cr, this.fields).newLine();
        }).write(t("}")).addMarginSymbol(t("+"));
      }
    };
    function Sn(e, r, t) {
      switch (e.kind) {
        case "MutuallyExclusiveFields":
          Ad(e, r);
          break;
        case "IncludeOnScalar":
          Cd(e, r);
          break;
        case "EmptySelection":
          Id(e, r, t);
          break;
        case "UnknownSelectionField":
          _d(e, r);
          break;
        case "InvalidSelectionValue":
          Nd(e, r);
          break;
        case "UnknownArgument":
          Ld(e, r);
          break;
        case "UnknownInputField":
          Fd(e, r);
          break;
        case "RequiredArgumentMissing":
          Md(e, r);
          break;
        case "InvalidArgumentType":
          $d(e, r);
          break;
        case "InvalidArgumentValue":
          qd(e, r);
          break;
        case "ValueTooLarge":
          Vd(e, r);
          break;
        case "SomeFieldsMissing":
          jd(e, r);
          break;
        case "TooManyFieldsGiven":
          Bd(e, r);
          break;
        case "Union":
          na(e, r, t);
          break;
        default:
          throw new Error("not implemented: " + e.kind);
      }
    }
    function Ad(e, r) {
      let t = r.arguments.getDeepSubSelectionValue(e.selectionPath)?.asObject();
      t && (t.getField(e.firstField)?.markAsError(), t.getField(e.secondField)?.markAsError()), r.addErrorMessage((n) => `Please ${n.bold("either")} use ${n.green(`\`${e.firstField}\``)} or ${n.green(`\`${e.secondField}\``)}, but ${n.red("not both")} at the same time.`);
    }
    function Cd(e, r) {
      let [t, n] = Or(e.selectionPath), i = e.outputType, o = r.arguments.getDeepSelectionParent(t)?.value;
      if (o && (o.getField(n)?.markAsError(), i)) for (let s of i.fields) s.isRelation && o.addSuggestion(new le(s.name, "true"));
      r.addErrorMessage((s) => {
        let a = `Invalid scalar field ${s.red(`\`${n}\``)} for ${s.bold("include")} statement`;
        return i ? a += ` on model ${s.bold(i.name)}. ${dt(s)}` : a += ".", a += `
Note that ${s.bold("include")} statements only accept relation fields.`, a;
      });
    }
    function Id(e, r, t) {
      let n = r.arguments.getDeepSubSelectionValue(e.selectionPath)?.asObject();
      if (n) {
        let i = n.getField("omit")?.value.asObject();
        if (i) {
          Dd(e, r, i);
          return;
        }
        if (n.hasField("select")) {
          Od(e, r);
          return;
        }
      }
      if (t?.[We(e.outputType.name)]) {
        kd(e, r);
        return;
      }
      r.addErrorMessage(() => `Unknown field at "${e.selectionPath.join(".")} selection"`);
    }
    function Dd(e, r, t) {
      t.removeAllFields();
      for (let n of e.outputType.fields) t.addSuggestion(new le(n.name, "false"));
      r.addErrorMessage((n) => `The ${n.red("omit")} statement includes every field of the model ${n.bold(e.outputType.name)}. At least one field must be included in the result`);
    }
    function Od(e, r) {
      let t = e.outputType, n = r.arguments.getDeepSelectionParent(e.selectionPath)?.value, i = n?.isEmpty() ?? false;
      n && (n.removeAllFields(), pa(n, t)), r.addErrorMessage((o) => i ? `The ${o.red("`select`")} statement for type ${o.bold(t.name)} must not be empty. ${dt(o)}` : `The ${o.red("`select`")} statement for type ${o.bold(t.name)} needs ${o.bold("at least one truthy value")}.`);
    }
    function kd(e, r) {
      let t = new pt();
      for (let i of e.outputType.fields) i.isRelation || t.addField(i.name, "false");
      let n = new le("omit", t).makeRequired();
      if (e.selectionPath.length === 0) r.arguments.addSuggestion(n);
      else {
        let [i, o] = Or(e.selectionPath), a = r.arguments.getDeepSelectionParent(i)?.value.asObject()?.getField(o);
        if (a) {
          let l = a?.value.asObject() ?? new Dr();
          l.addSuggestion(n), a.value = l;
        }
      }
      r.addErrorMessage((i) => `The global ${i.red("omit")} configuration excludes every field of the model ${i.bold(e.outputType.name)}. At least one field must be included in the result`);
    }
    function _d(e, r) {
      let t = da(e.selectionPath, r);
      if (t.parentKind !== "unknown") {
        t.field.markAsError();
        let n = t.parent;
        switch (t.parentKind) {
          case "select":
            pa(n, e.outputType);
            break;
          case "include":
            Ud(n, e.outputType);
            break;
          case "omit":
            Gd(n, e.outputType);
            break;
        }
      }
      r.addErrorMessage((n) => {
        let i = [`Unknown field ${n.red(`\`${t.fieldName}\``)}`];
        return t.parentKind !== "unknown" && i.push(`for ${n.bold(t.parentKind)} statement`), i.push(`on model ${n.bold(`\`${e.outputType.name}\``)}.`), i.push(dt(n)), i.join(" ");
      });
    }
    function Nd(e, r) {
      let t = da(e.selectionPath, r);
      t.parentKind !== "unknown" && t.field.value.markAsError(), r.addErrorMessage((n) => `Invalid value for selection field \`${n.red(t.fieldName)}\`: ${e.underlyingError}`);
    }
    function Ld(e, r) {
      let t = e.argumentPath[0], n = r.arguments.getDeepSubSelectionValue(e.selectionPath)?.asObject();
      n && (n.getField(t)?.markAsError(), Qd(n, e.arguments)), r.addErrorMessage((i) => ua(i, t, e.arguments.map((o) => o.name)));
    }
    function Fd(e, r) {
      let [t, n] = Or(e.argumentPath), i = r.arguments.getDeepSubSelectionValue(e.selectionPath)?.asObject();
      if (i) {
        i.getDeepField(e.argumentPath)?.markAsError();
        let o = i.getDeepFieldValue(t)?.asObject();
        o && ma(o, e.inputType);
      }
      r.addErrorMessage((o) => ua(o, n, e.inputType.fields.map((s) => s.name)));
    }
    function ua(e, r, t) {
      let n = [`Unknown argument \`${e.red(r)}\`.`], i = Jd(r, t);
      return i && n.push(`Did you mean \`${e.green(i)}\`?`), t.length > 0 && n.push(dt(e)), n.join(" ");
    }
    function Md(e, r) {
      let t;
      r.addErrorMessage((l) => t?.value instanceof Q && t.value.text === "null" ? `Argument \`${l.green(o)}\` must not be ${l.red("null")}.` : `Argument \`${l.green(o)}\` is missing.`);
      let n = r.arguments.getDeepSubSelectionValue(e.selectionPath)?.asObject();
      if (!n) return;
      let [i, o] = Or(e.argumentPath), s = new pt(), a = n.getDeepFieldValue(i)?.asObject();
      if (a) {
        if (t = a.getField(o), t && a.removeField(o), e.inputTypes.length === 1 && e.inputTypes[0].kind === "object") {
          for (let l of e.inputTypes[0].fields) s.addField(l.name, l.typeNames.join(" | "));
          a.addSuggestion(new le(o, s).makeRequired());
        } else {
          let l = e.inputTypes.map(ca).join(" | ");
          a.addSuggestion(new le(o, l).makeRequired());
        }
        if (e.dependentArgumentPath) {
          n.getDeepField(e.dependentArgumentPath)?.markAsError();
          let [, l] = Or(e.dependentArgumentPath);
          r.addErrorMessage((u) => `Argument \`${u.green(o)}\` is required because argument \`${u.green(l)}\` was provided.`);
        }
      }
    }
    function ca(e) {
      return e.kind === "list" ? `${ca(e.elementType)}[]` : e.name;
    }
    function $d(e, r) {
      let t = e.argument.name, n = r.arguments.getDeepSubSelectionValue(e.selectionPath)?.asObject();
      n && n.getDeepFieldValue(e.argumentPath)?.markAsError(), r.addErrorMessage((i) => {
        let o = In("or", e.argument.typeNames.map((s) => i.green(s)));
        return `Argument \`${i.bold(t)}\`: Invalid value provided. Expected ${o}, provided ${i.red(e.inferredType)}.`;
      });
    }
    function qd(e, r) {
      let t = e.argument.name, n = r.arguments.getDeepSubSelectionValue(e.selectionPath)?.asObject();
      n && n.getDeepFieldValue(e.argumentPath)?.markAsError(), r.addErrorMessage((i) => {
        let o = [`Invalid value for argument \`${i.bold(t)}\``];
        if (e.underlyingError && o.push(`: ${e.underlyingError}`), o.push("."), e.argument.typeNames.length > 0) {
          let s = In("or", e.argument.typeNames.map((a) => i.green(a)));
          o.push(` Expected ${s}.`);
        }
        return o.join("");
      });
    }
    function Vd(e, r) {
      let t = e.argument.name, n = r.arguments.getDeepSubSelectionValue(e.selectionPath)?.asObject(), i;
      if (n) {
        let s = n.getDeepField(e.argumentPath)?.value;
        s?.markAsError(), s instanceof Q && (i = s.text);
      }
      r.addErrorMessage((o) => {
        let s = ["Unable to fit value"];
        return i && s.push(o.red(i)), s.push(`into a 64-bit signed integer for field \`${o.bold(t)}\``), s.join(" ");
      });
    }
    function jd(e, r) {
      let t = e.argumentPath[e.argumentPath.length - 1], n = r.arguments.getDeepSubSelectionValue(e.selectionPath)?.asObject();
      if (n) {
        let i = n.getDeepFieldValue(e.argumentPath)?.asObject();
        i && ma(i, e.inputType);
      }
      r.addErrorMessage((i) => {
        let o = [`Argument \`${i.bold(t)}\` of type ${i.bold(e.inputType.name)} needs`];
        return e.constraints.minFieldCount === 1 ? e.constraints.requiredFields ? o.push(`${i.green("at least one of")} ${In("or", e.constraints.requiredFields.map((s) => `\`${i.bold(s)}\``))} arguments.`) : o.push(`${i.green("at least one")} argument.`) : o.push(`${i.green(`at least ${e.constraints.minFieldCount}`)} arguments.`), o.push(dt(i)), o.join(" ");
      });
    }
    function Bd(e, r) {
      let t = e.argumentPath[e.argumentPath.length - 1], n = r.arguments.getDeepSubSelectionValue(e.selectionPath)?.asObject(), i = [];
      if (n) {
        let o = n.getDeepFieldValue(e.argumentPath)?.asObject();
        o && (o.markAsError(), i = Object.keys(o.getFields()));
      }
      r.addErrorMessage((o) => {
        let s = [`Argument \`${o.bold(t)}\` of type ${o.bold(e.inputType.name)} needs`];
        return e.constraints.minFieldCount === 1 && e.constraints.maxFieldCount == 1 ? s.push(`${o.green("exactly one")} argument,`) : e.constraints.maxFieldCount == 1 ? s.push(`${o.green("at most one")} argument,`) : s.push(`${o.green(`at most ${e.constraints.maxFieldCount}`)} arguments,`), s.push(`but you provided ${In("and", i.map((a) => o.red(a)))}. Please choose`), e.constraints.maxFieldCount === 1 ? s.push("one.") : s.push(`${e.constraints.maxFieldCount}.`), s.join(" ");
      });
    }
    function pa(e, r) {
      for (let t of r.fields) e.hasField(t.name) || e.addSuggestion(new le(t.name, "true"));
    }
    function Ud(e, r) {
      for (let t of r.fields) t.isRelation && !e.hasField(t.name) && e.addSuggestion(new le(t.name, "true"));
    }
    function Gd(e, r) {
      for (let t of r.fields) !e.hasField(t.name) && !t.isRelation && e.addSuggestion(new le(t.name, "true"));
    }
    function Qd(e, r) {
      for (let t of r) e.hasField(t.name) || e.addSuggestion(new le(t.name, t.typeNames.join(" | ")));
    }
    function da(e, r) {
      let [t, n] = Or(e), i = r.arguments.getDeepSubSelectionValue(t)?.asObject();
      if (!i) return { parentKind: "unknown", fieldName: n };
      let o = i.getFieldValue("select")?.asObject(), s = i.getFieldValue("include")?.asObject(), a = i.getFieldValue("omit")?.asObject(), l = o?.getField(n);
      return o && l ? { parentKind: "select", parent: o, field: l, fieldName: n } : (l = s?.getField(n), s && l ? { parentKind: "include", field: l, parent: s, fieldName: n } : (l = a?.getField(n), a && l ? { parentKind: "omit", field: l, parent: a, fieldName: n } : { parentKind: "unknown", fieldName: n }));
    }
    function ma(e, r) {
      if (r.kind === "object") for (let t of r.fields) e.hasField(t.name) || e.addSuggestion(new le(t.name, t.typeNames.join(" | ")));
    }
    function Or(e) {
      let r = [...e], t = r.pop();
      if (!t) throw new Error("unexpected empty path");
      return [r, t];
    }
    function dt({ green: e, enabled: r }) {
      return "Available options are " + (r ? `listed in ${e("green")}` : "marked with ?") + ".";
    }
    function In(e, r) {
      if (r.length === 1) return r[0];
      let t = [...r], n = t.pop();
      return `${t.join(", ")} ${e} ${n}`;
    }
    var Wd = 3;
    function Jd(e, r) {
      let t = 1 / 0, n;
      for (let i of r) {
        let o = (0, la.default)(e, i);
        o > Wd || o < t && (t = o, n = i);
      }
      return n;
    }
    var mt = class {
      modelName;
      name;
      typeName;
      isList;
      isEnum;
      constructor(r, t, n, i, o) {
        this.modelName = r, this.name = t, this.typeName = n, this.isList = i, this.isEnum = o;
      }
      _toGraphQLInputType() {
        let r = this.isList ? "List" : "", t = this.isEnum ? "Enum" : "";
        return `${r}${t}${this.typeName}FieldRefInput<${this.modelName}>`;
      }
    };
    function kr(e) {
      return e instanceof mt;
    }
    var Dn = Symbol();
    var Yi = /* @__PURE__ */ new WeakMap();
    var Me = class {
      constructor(r) {
        r === Dn ? Yi.set(this, `Prisma.${this._getName()}`) : Yi.set(this, `new Prisma.${this._getNamespace()}.${this._getName()}()`);
      }
      _getName() {
        return this.constructor.name;
      }
      toString() {
        return Yi.get(this);
      }
    };
    var ft = class extends Me {
      _getNamespace() {
        return "NullTypes";
      }
    };
    var gt = class extends ft {
      #e;
    };
    zi(gt, "DbNull");
    var ht = class extends ft {
      #e;
    };
    zi(ht, "JsonNull");
    var yt = class extends ft {
      #e;
    };
    zi(yt, "AnyNull");
    var On = { classes: { DbNull: gt, JsonNull: ht, AnyNull: yt }, instances: { DbNull: new gt(Dn), JsonNull: new ht(Dn), AnyNull: new yt(Dn) } };
    function zi(e, r) {
      Object.defineProperty(e, "name", { value: r, configurable: true });
    }
    var fa = ": ";
    var kn = class {
      constructor(r, t) {
        this.name = r;
        this.value = t;
      }
      hasError = false;
      markAsError() {
        this.hasError = true;
      }
      getPrintWidth() {
        return this.name.length + this.value.getPrintWidth() + fa.length;
      }
      write(r) {
        let t = new Pe(this.name);
        this.hasError && t.underline().setColor(r.context.colors.red), r.write(t).write(fa).write(this.value);
      }
    };
    var Zi = class {
      arguments;
      errorMessages = [];
      constructor(r) {
        this.arguments = r;
      }
      write(r) {
        r.write(this.arguments);
      }
      addErrorMessage(r) {
        this.errorMessages.push(r);
      }
      renderAllMessages(r) {
        return this.errorMessages.map((t) => t(r)).join(`
`);
      }
    };
    function _r(e) {
      return new Zi(ga(e));
    }
    function ga(e) {
      let r = new Dr();
      for (let [t, n] of Object.entries(e)) {
        let i = new kn(t, ha(n));
        r.addField(i);
      }
      return r;
    }
    function ha(e) {
      if (typeof e == "string") return new Q(JSON.stringify(e));
      if (typeof e == "number" || typeof e == "boolean") return new Q(String(e));
      if (typeof e == "bigint") return new Q(`${e}n`);
      if (e === null) return new Q("null");
      if (e === void 0) return new Q("undefined");
      if (Sr(e)) return new Q(`new Prisma.Decimal("${e.toFixed()}")`);
      if (e instanceof Uint8Array) return Buffer.isBuffer(e) ? new Q(`Buffer.alloc(${e.byteLength})`) : new Q(`new Uint8Array(${e.byteLength})`);
      if (e instanceof Date) {
        let r = mn(e) ? e.toISOString() : "Invalid Date";
        return new Q(`new Date("${r}")`);
      }
      return e instanceof Me ? new Q(`Prisma.${e._getName()}`) : kr(e) ? new Q(`prisma.${We(e.modelName)}.$fields.${e.name}`) : Array.isArray(e) ? Kd(e) : typeof e == "object" ? ga(e) : new Q(Object.prototype.toString.call(e));
    }
    function Kd(e) {
      let r = new Ir();
      for (let t of e) r.addItem(ha(t));
      return r;
    }
    function _n(e, r) {
      let t = r === "pretty" ? aa : Cn, n = e.renderAllMessages(t), i = new Ar(0, { colors: t }).write(e).toString();
      return { message: n, args: i };
    }
    function Nn({ args: e, errors: r, errorFormat: t, callsite: n, originalMethod: i, clientVersion: o, globalOmit: s }) {
      let a = _r(e);
      for (let p of r) Sn(p, a, s);
      let { message: l, args: u } = _n(a, t), c = Tn({ message: l, callsite: n, originalMethod: i, showColors: t === "pretty", callArguments: u });
      throw new Z(c, { clientVersion: o });
    }
    function Te(e) {
      return e.replace(/^./, (r) => r.toLowerCase());
    }
    function ba(e, r, t) {
      let n = Te(t);
      return !r.result || !(r.result.$allModels || r.result[n]) ? e : Hd({ ...e, ...ya(r.name, e, r.result.$allModels), ...ya(r.name, e, r.result[n]) });
    }
    function Hd(e) {
      let r = new we(), t = (n, i) => r.getOrCreate(n, () => i.has(n) ? [n] : (i.add(n), e[n] ? e[n].needs.flatMap((o) => t(o, i)) : [n]));
      return pn(e, (n) => ({ ...n, needs: t(n.name, /* @__PURE__ */ new Set()) }));
    }
    function ya(e, r, t) {
      return t ? pn(t, ({ needs: n, compute: i }, o) => ({ name: o, needs: n ? Object.keys(n).filter((s) => n[s]) : [], compute: Yd(r, o, i) })) : {};
    }
    function Yd(e, r, t) {
      let n = e?.[r]?.compute;
      return n ? (i) => t({ ...i, [r]: n(i) }) : t;
    }
    function Ea(e, r) {
      if (!r) return e;
      let t = { ...e };
      for (let n of Object.values(r)) if (e[n.name]) for (let i of n.needs) t[i] = true;
      return t;
    }
    function wa(e, r) {
      if (!r) return e;
      let t = { ...e };
      for (let n of Object.values(r)) if (!e[n.name]) for (let i of n.needs) delete t[i];
      return t;
    }
    var Ln = class {
      constructor(r, t) {
        this.extension = r;
        this.previous = t;
      }
      computedFieldsCache = new we();
      modelExtensionsCache = new we();
      queryCallbacksCache = new we();
      clientExtensions = lt(() => this.extension.client ? { ...this.previous?.getAllClientExtensions(), ...this.extension.client } : this.previous?.getAllClientExtensions());
      batchCallbacks = lt(() => {
        let r = this.previous?.getAllBatchQueryCallbacks() ?? [], t = this.extension.query?.$__internalBatch;
        return t ? r.concat(t) : r;
      });
      getAllComputedFields(r) {
        return this.computedFieldsCache.getOrCreate(r, () => ba(this.previous?.getAllComputedFields(r), this.extension, r));
      }
      getAllClientExtensions() {
        return this.clientExtensions.get();
      }
      getAllModelExtensions(r) {
        return this.modelExtensionsCache.getOrCreate(r, () => {
          let t = Te(r);
          return !this.extension.model || !(this.extension.model[t] || this.extension.model.$allModels) ? this.previous?.getAllModelExtensions(r) : { ...this.previous?.getAllModelExtensions(r), ...this.extension.model.$allModels, ...this.extension.model[t] };
        });
      }
      getAllQueryCallbacks(r, t) {
        return this.queryCallbacksCache.getOrCreate(`${r}:${t}`, () => {
          let n = this.previous?.getAllQueryCallbacks(r, t) ?? [], i = [], o = this.extension.query;
          return !o || !(o[r] || o.$allModels || o[t] || o.$allOperations) ? n : (o[r] !== void 0 && (o[r][t] !== void 0 && i.push(o[r][t]), o[r].$allOperations !== void 0 && i.push(o[r].$allOperations)), r !== "$none" && o.$allModels !== void 0 && (o.$allModels[t] !== void 0 && i.push(o.$allModels[t]), o.$allModels.$allOperations !== void 0 && i.push(o.$allModels.$allOperations)), o[t] !== void 0 && i.push(o[t]), o.$allOperations !== void 0 && i.push(o.$allOperations), n.concat(i));
        });
      }
      getAllBatchQueryCallbacks() {
        return this.batchCallbacks.get();
      }
    };
    var Nr = class e {
      constructor(r) {
        this.head = r;
      }
      static empty() {
        return new e();
      }
      static single(r) {
        return new e(new Ln(r));
      }
      isEmpty() {
        return this.head === void 0;
      }
      append(r) {
        return new e(new Ln(r, this.head));
      }
      getAllComputedFields(r) {
        return this.head?.getAllComputedFields(r);
      }
      getAllClientExtensions() {
        return this.head?.getAllClientExtensions();
      }
      getAllModelExtensions(r) {
        return this.head?.getAllModelExtensions(r);
      }
      getAllQueryCallbacks(r, t) {
        return this.head?.getAllQueryCallbacks(r, t) ?? [];
      }
      getAllBatchQueryCallbacks() {
        return this.head?.getAllBatchQueryCallbacks() ?? [];
      }
    };
    var Fn = class {
      constructor(r) {
        this.name = r;
      }
    };
    function xa(e) {
      return e instanceof Fn;
    }
    function va(e) {
      return new Fn(e);
    }
    var Pa = Symbol();
    var bt = class {
      constructor(r) {
        if (r !== Pa) throw new Error("Skip instance can not be constructed directly");
      }
      ifUndefined(r) {
        return r === void 0 ? Mn : r;
      }
    };
    var Mn = new bt(Pa);
    function Se(e) {
      return e instanceof bt;
    }
    var zd = { findUnique: "findUnique", findUniqueOrThrow: "findUniqueOrThrow", findFirst: "findFirst", findFirstOrThrow: "findFirstOrThrow", findMany: "findMany", count: "aggregate", create: "createOne", createMany: "createMany", createManyAndReturn: "createManyAndReturn", update: "updateOne", updateMany: "updateMany", updateManyAndReturn: "updateManyAndReturn", upsert: "upsertOne", delete: "deleteOne", deleteMany: "deleteMany", executeRaw: "executeRaw", queryRaw: "queryRaw", aggregate: "aggregate", groupBy: "groupBy", runCommandRaw: "runCommandRaw", findRaw: "findRaw", aggregateRaw: "aggregateRaw" };
    var Ta = "explicitly `undefined` values are not allowed";
    function $n({ modelName: e, action: r, args: t, runtimeDataModel: n, extensions: i = Nr.empty(), callsite: o, clientMethod: s, errorFormat: a, clientVersion: l, previewFeatures: u, globalOmit: c }) {
      let p = new Xi({ runtimeDataModel: n, modelName: e, action: r, rootArgs: t, callsite: o, extensions: i, selectionPath: [], argumentPath: [], originalMethod: s, errorFormat: a, clientVersion: l, previewFeatures: u, globalOmit: c });
      return { modelName: e, action: zd[r], query: Et(t, p) };
    }
    function Et({ select: e, include: r, ...t } = {}, n) {
      let i = t.omit;
      return delete t.omit, { arguments: Ra(t, n), selection: Zd(e, r, i, n) };
    }
    function Zd(e, r, t, n) {
      return e ? (r ? n.throwValidationError({ kind: "MutuallyExclusiveFields", firstField: "include", secondField: "select", selectionPath: n.getSelectionPath() }) : t && n.throwValidationError({ kind: "MutuallyExclusiveFields", firstField: "omit", secondField: "select", selectionPath: n.getSelectionPath() }), tm(e, n)) : Xd(n, r, t);
    }
    function Xd(e, r, t) {
      let n = {};
      return e.modelOrType && !e.isRawAction() && (n.$composites = true, n.$scalars = true), r && em(n, r, e), rm(n, t, e), n;
    }
    function em(e, r, t) {
      for (let [n, i] of Object.entries(r)) {
        if (Se(i)) continue;
        let o = t.nestSelection(n);
        if (eo(i, o), i === false || i === void 0) {
          e[n] = false;
          continue;
        }
        let s = t.findField(n);
        if (s && s.kind !== "object" && t.throwValidationError({ kind: "IncludeOnScalar", selectionPath: t.getSelectionPath().concat(n), outputType: t.getOutputTypeDescription() }), s) {
          e[n] = Et(i === true ? {} : i, o);
          continue;
        }
        if (i === true) {
          e[n] = true;
          continue;
        }
        e[n] = Et(i, o);
      }
    }
    function rm(e, r, t) {
      let n = t.getComputedFields(), i = { ...t.getGlobalOmit(), ...r }, o = wa(i, n);
      for (let [s, a] of Object.entries(o)) {
        if (Se(a)) continue;
        eo(a, t.nestSelection(s));
        let l = t.findField(s);
        n?.[s] && !l || (e[s] = !a);
      }
    }
    function tm(e, r) {
      let t = {}, n = r.getComputedFields(), i = Ea(e, n);
      for (let [o, s] of Object.entries(i)) {
        if (Se(s)) continue;
        let a = r.nestSelection(o);
        eo(s, a);
        let l = r.findField(o);
        if (!(n?.[o] && !l)) {
          if (s === false || s === void 0 || Se(s)) {
            t[o] = false;
            continue;
          }
          if (s === true) {
            l?.kind === "object" ? t[o] = Et({}, a) : t[o] = true;
            continue;
          }
          t[o] = Et(s, a);
        }
      }
      return t;
    }
    function Sa(e, r) {
      if (e === null) return null;
      if (typeof e == "string" || typeof e == "number" || typeof e == "boolean") return e;
      if (typeof e == "bigint") return { $type: "BigInt", value: String(e) };
      if (vr(e)) {
        if (mn(e)) return { $type: "DateTime", value: e.toISOString() };
        r.throwValidationError({ kind: "InvalidArgumentValue", selectionPath: r.getSelectionPath(), argumentPath: r.getArgumentPath(), argument: { name: r.getArgumentName(), typeNames: ["Date"] }, underlyingError: "Provided Date object is invalid" });
      }
      if (xa(e)) return { $type: "Param", value: e.name };
      if (kr(e)) return { $type: "FieldRef", value: { _ref: e.name, _container: e.modelName } };
      if (Array.isArray(e)) return nm(e, r);
      if (ArrayBuffer.isView(e)) {
        let { buffer: t, byteOffset: n, byteLength: i } = e;
        return { $type: "Bytes", value: Buffer.from(t, n, i).toString("base64") };
      }
      if (im(e)) return e.values;
      if (Sr(e)) return { $type: "Decimal", value: e.toFixed() };
      if (e instanceof Me) {
        if (e !== On.instances[e._getName()]) throw new Error("Invalid ObjectEnumValue");
        return { $type: "Enum", value: e._getName() };
      }
      if (om(e)) return e.toJSON();
      if (typeof e == "object") return Ra(e, r);
      r.throwValidationError({ kind: "InvalidArgumentValue", selectionPath: r.getSelectionPath(), argumentPath: r.getArgumentPath(), argument: { name: r.getArgumentName(), typeNames: [] }, underlyingError: `We could not serialize ${Object.prototype.toString.call(e)} value. Serialize the object to JSON or implement a ".toJSON()" method on it` });
    }
    function Ra(e, r) {
      if (e.$type) return { $type: "Raw", value: e };
      let t = {};
      for (let n in e) {
        let i = e[n], o = r.nestArgument(n);
        Se(i) || (i !== void 0 ? t[n] = Sa(i, o) : r.isPreviewFeatureOn("strictUndefinedChecks") && r.throwValidationError({ kind: "InvalidArgumentValue", argumentPath: o.getArgumentPath(), selectionPath: r.getSelectionPath(), argument: { name: r.getArgumentName(), typeNames: [] }, underlyingError: Ta }));
      }
      return t;
    }
    function nm(e, r) {
      let t = [];
      for (let n = 0; n < e.length; n++) {
        let i = r.nestArgument(String(n)), o = e[n];
        if (o === void 0 || Se(o)) {
          let s = o === void 0 ? "undefined" : "Prisma.skip";
          r.throwValidationError({ kind: "InvalidArgumentValue", selectionPath: i.getSelectionPath(), argumentPath: i.getArgumentPath(), argument: { name: `${r.getArgumentName()}[${n}]`, typeNames: [] }, underlyingError: `Can not use \`${s}\` value within array. Use \`null\` or filter out \`${s}\` values` });
        }
        t.push(Sa(o, i));
      }
      return t;
    }
    function im(e) {
      return typeof e == "object" && e !== null && e.__prismaRawParameters__ === true;
    }
    function om(e) {
      return typeof e == "object" && e !== null && typeof e.toJSON == "function";
    }
    function eo(e, r) {
      e === void 0 && r.isPreviewFeatureOn("strictUndefinedChecks") && r.throwValidationError({ kind: "InvalidSelectionValue", selectionPath: r.getSelectionPath(), underlyingError: Ta });
    }
    var Xi = class e {
      constructor(r) {
        this.params = r;
        this.params.modelName && (this.modelOrType = this.params.runtimeDataModel.models[this.params.modelName] ?? this.params.runtimeDataModel.types[this.params.modelName]);
      }
      modelOrType;
      throwValidationError(r) {
        Nn({ errors: [r], originalMethod: this.params.originalMethod, args: this.params.rootArgs ?? {}, callsite: this.params.callsite, errorFormat: this.params.errorFormat, clientVersion: this.params.clientVersion, globalOmit: this.params.globalOmit });
      }
      getSelectionPath() {
        return this.params.selectionPath;
      }
      getArgumentPath() {
        return this.params.argumentPath;
      }
      getArgumentName() {
        return this.params.argumentPath[this.params.argumentPath.length - 1];
      }
      getOutputTypeDescription() {
        if (!(!this.params.modelName || !this.modelOrType)) return { name: this.params.modelName, fields: this.modelOrType.fields.map((r) => ({ name: r.name, typeName: "boolean", isRelation: r.kind === "object" })) };
      }
      isRawAction() {
        return ["executeRaw", "queryRaw", "runCommandRaw", "findRaw", "aggregateRaw"].includes(this.params.action);
      }
      isPreviewFeatureOn(r) {
        return this.params.previewFeatures.includes(r);
      }
      getComputedFields() {
        if (this.params.modelName) return this.params.extensions.getAllComputedFields(this.params.modelName);
      }
      findField(r) {
        return this.modelOrType?.fields.find((t) => t.name === r);
      }
      nestSelection(r) {
        let t = this.findField(r), n = t?.kind === "object" ? t.type : void 0;
        return new e({ ...this.params, modelName: n, selectionPath: this.params.selectionPath.concat(r) });
      }
      getGlobalOmit() {
        return this.params.modelName && this.shouldApplyGlobalOmit() ? this.params.globalOmit?.[We(this.params.modelName)] ?? {} : {};
      }
      shouldApplyGlobalOmit() {
        switch (this.params.action) {
          case "findFirst":
          case "findFirstOrThrow":
          case "findUniqueOrThrow":
          case "findMany":
          case "upsert":
          case "findUnique":
          case "createManyAndReturn":
          case "create":
          case "update":
          case "updateManyAndReturn":
          case "delete":
            return true;
          case "executeRaw":
          case "aggregateRaw":
          case "runCommandRaw":
          case "findRaw":
          case "createMany":
          case "deleteMany":
          case "groupBy":
          case "updateMany":
          case "count":
          case "aggregate":
          case "queryRaw":
            return false;
          default:
            ar(this.params.action, "Unknown action");
        }
      }
      nestArgument(r) {
        return new e({ ...this.params, argumentPath: this.params.argumentPath.concat(r) });
      }
    };
    function Aa(e) {
      if (!e._hasPreviewFlag("metrics")) throw new Z("`metrics` preview feature must be enabled in order to access metrics API", { clientVersion: e._clientVersion });
    }
    var Lr = class {
      _client;
      constructor(r) {
        this._client = r;
      }
      prometheus(r) {
        return Aa(this._client), this._client._engine.metrics({ format: "prometheus", ...r });
      }
      json(r) {
        return Aa(this._client), this._client._engine.metrics({ format: "json", ...r });
      }
    };
    function Ca(e, r) {
      let t = lt(() => sm(r));
      Object.defineProperty(e, "dmmf", { get: () => t.get() });
    }
    function sm(e) {
      return { datamodel: { models: ro(e.models), enums: ro(e.enums), types: ro(e.types) } };
    }
    function ro(e) {
      return Object.entries(e).map(([r, t]) => ({ name: r, ...t }));
    }
    var to = /* @__PURE__ */ new WeakMap();
    var qn = "$$PrismaTypedSql";
    var wt = class {
      constructor(r, t) {
        to.set(this, { sql: r, values: t }), Object.defineProperty(this, qn, { value: qn });
      }
      get sql() {
        return to.get(this).sql;
      }
      get values() {
        return to.get(this).values;
      }
    };
    function Ia(e) {
      return (...r) => new wt(e, r);
    }
    function Vn(e) {
      return e != null && e[qn] === qn;
    }
    var cu = O(Ti());
    var pu = require("node:async_hooks");
    var du = require("node:events");
    var mu = O(require("node:fs"));
    var ri = O(require("node:path"));
    var ie = class e {
      constructor(r, t) {
        if (r.length - 1 !== t.length) throw r.length === 0 ? new TypeError("Expected at least 1 string") : new TypeError(`Expected ${r.length} strings to have ${r.length - 1} values`);
        let n = t.reduce((s, a) => s + (a instanceof e ? a.values.length : 1), 0);
        this.values = new Array(n), this.strings = new Array(n + 1), this.strings[0] = r[0];
        let i = 0, o = 0;
        for (; i < t.length; ) {
          let s = t[i++], a = r[i];
          if (s instanceof e) {
            this.strings[o] += s.strings[0];
            let l = 0;
            for (; l < s.values.length; ) this.values[o++] = s.values[l++], this.strings[o] = s.strings[l];
            this.strings[o] += a;
          } else this.values[o++] = s, this.strings[o] = a;
        }
      }
      get sql() {
        let r = this.strings.length, t = 1, n = this.strings[0];
        for (; t < r; ) n += `?${this.strings[t++]}`;
        return n;
      }
      get statement() {
        let r = this.strings.length, t = 1, n = this.strings[0];
        for (; t < r; ) n += `:${t}${this.strings[t++]}`;
        return n;
      }
      get text() {
        let r = this.strings.length, t = 1, n = this.strings[0];
        for (; t < r; ) n += `$${t}${this.strings[t++]}`;
        return n;
      }
      inspect() {
        return { sql: this.sql, statement: this.statement, text: this.text, values: this.values };
      }
    };
    function Da(e, r = ",", t = "", n = "") {
      if (e.length === 0) throw new TypeError("Expected `join([])` to be called with an array of multiple elements, but got an empty array");
      return new ie([t, ...Array(e.length - 1).fill(r), n], e);
    }
    function no(e) {
      return new ie([e], []);
    }
    var Oa = no("");
    function io(e, ...r) {
      return new ie(e, r);
    }
    function xt(e) {
      return { getKeys() {
        return Object.keys(e);
      }, getPropertyValue(r) {
        return e[r];
      } };
    }
    function re(e, r) {
      return { getKeys() {
        return [e];
      }, getPropertyValue() {
        return r();
      } };
    }
    function lr(e) {
      let r = new we();
      return { getKeys() {
        return e.getKeys();
      }, getPropertyValue(t) {
        return r.getOrCreate(t, () => e.getPropertyValue(t));
      }, getPropertyDescriptor(t) {
        return e.getPropertyDescriptor?.(t);
      } };
    }
    var jn = { enumerable: true, configurable: true, writable: true };
    function Bn(e) {
      let r = new Set(e);
      return { getPrototypeOf: () => Object.prototype, getOwnPropertyDescriptor: () => jn, has: (t, n) => r.has(n), set: (t, n, i) => r.add(n) && Reflect.set(t, n, i), ownKeys: () => [...r] };
    }
    var ka = Symbol.for("nodejs.util.inspect.custom");
    function he(e, r) {
      let t = am(r), n = /* @__PURE__ */ new Set(), i = new Proxy(e, { get(o, s) {
        if (n.has(s)) return o[s];
        let a = t.get(s);
        return a ? a.getPropertyValue(s) : o[s];
      }, has(o, s) {
        if (n.has(s)) return true;
        let a = t.get(s);
        return a ? a.has?.(s) ?? true : Reflect.has(o, s);
      }, ownKeys(o) {
        let s = _a(Reflect.ownKeys(o), t), a = _a(Array.from(t.keys()), t);
        return [.../* @__PURE__ */ new Set([...s, ...a, ...n])];
      }, set(o, s, a) {
        return t.get(s)?.getPropertyDescriptor?.(s)?.writable === false ? false : (n.add(s), Reflect.set(o, s, a));
      }, getOwnPropertyDescriptor(o, s) {
        let a = Reflect.getOwnPropertyDescriptor(o, s);
        if (a && !a.configurable) return a;
        let l = t.get(s);
        return l ? l.getPropertyDescriptor ? { ...jn, ...l?.getPropertyDescriptor(s) } : jn : a;
      }, defineProperty(o, s, a) {
        return n.add(s), Reflect.defineProperty(o, s, a);
      }, getPrototypeOf: () => Object.prototype });
      return i[ka] = function() {
        let o = { ...this };
        return delete o[ka], o;
      }, i;
    }
    function am(e) {
      let r = /* @__PURE__ */ new Map();
      for (let t of e) {
        let n = t.getKeys();
        for (let i of n) r.set(i, t);
      }
      return r;
    }
    function _a(e, r) {
      return e.filter((t) => r.get(t)?.has?.(t) ?? true);
    }
    function Fr(e) {
      return { getKeys() {
        return e;
      }, has() {
        return false;
      }, getPropertyValue() {
      } };
    }
    function Mr(e, r) {
      return { batch: e, transaction: r?.kind === "batch" ? { isolationLevel: r.options.isolationLevel } : void 0 };
    }
    function Na(e) {
      if (e === void 0) return "";
      let r = _r(e);
      return new Ar(0, { colors: Cn }).write(r).toString();
    }
    var lm = "P2037";
    function $r({ error: e, user_facing_error: r }, t, n) {
      return r.error_code ? new z2(um(r, n), { code: r.error_code, clientVersion: t, meta: r.meta, batchRequestIdx: r.batch_request_idx }) : new V(e, { clientVersion: t, batchRequestIdx: r.batch_request_idx });
    }
    function um(e, r) {
      let t = e.message;
      return (r === "postgresql" || r === "postgres" || r === "mysql") && e.error_code === lm && (t += `
Prisma Accelerate has built-in connection pooling to prevent such errors: https://pris.ly/client/error-accelerate`), t;
    }
    var vt = "<unknown>";
    function La(e) {
      var r = e.split(`
`);
      return r.reduce(function(t, n) {
        var i = dm(n) || fm(n) || ym(n) || xm(n) || Em(n);
        return i && t.push(i), t;
      }, []);
    }
    var cm = /^\s*at (.*?) ?\(((?:file|https?|blob|chrome-extension|native|eval|webpack|rsc|<anonymous>|\/|[a-z]:\\|\\\\).*?)(?::(\d+))?(?::(\d+))?\)?\s*$/i;
    var pm = /\((\S*)(?::(\d+))(?::(\d+))\)/;
    function dm(e) {
      var r = cm.exec(e);
      if (!r) return null;
      var t = r[2] && r[2].indexOf("native") === 0, n = r[2] && r[2].indexOf("eval") === 0, i = pm.exec(r[2]);
      return n && i != null && (r[2] = i[1], r[3] = i[2], r[4] = i[3]), { file: t ? null : r[2], methodName: r[1] || vt, arguments: t ? [r[2]] : [], lineNumber: r[3] ? +r[3] : null, column: r[4] ? +r[4] : null };
    }
    var mm = /^\s*at (?:((?:\[object object\])?.+) )?\(?((?:file|ms-appx|https?|webpack|rsc|blob):.*?):(\d+)(?::(\d+))?\)?\s*$/i;
    function fm(e) {
      var r = mm.exec(e);
      return r ? { file: r[2], methodName: r[1] || vt, arguments: [], lineNumber: +r[3], column: r[4] ? +r[4] : null } : null;
    }
    var gm = /^\s*(.*?)(?:\((.*?)\))?(?:^|@)((?:file|https?|blob|chrome|webpack|rsc|resource|\[native).*?|[^@]*bundle)(?::(\d+))?(?::(\d+))?\s*$/i;
    var hm = /(\S+) line (\d+)(?: > eval line \d+)* > eval/i;
    function ym(e) {
      var r = gm.exec(e);
      if (!r) return null;
      var t = r[3] && r[3].indexOf(" > eval") > -1, n = hm.exec(r[3]);
      return t && n != null && (r[3] = n[1], r[4] = n[2], r[5] = null), { file: r[3], methodName: r[1] || vt, arguments: r[2] ? r[2].split(",") : [], lineNumber: r[4] ? +r[4] : null, column: r[5] ? +r[5] : null };
    }
    var bm = /^\s*(?:([^@]*)(?:\((.*?)\))?@)?(\S.*?):(\d+)(?::(\d+))?\s*$/i;
    function Em(e) {
      var r = bm.exec(e);
      return r ? { file: r[3], methodName: r[1] || vt, arguments: [], lineNumber: +r[4], column: r[5] ? +r[5] : null } : null;
    }
    var wm = /^\s*at (?:((?:\[object object\])?[^\\/]+(?: \[as \S+\])?) )?\(?(.*?):(\d+)(?::(\d+))?\)?\s*$/i;
    function xm(e) {
      var r = wm.exec(e);
      return r ? { file: r[2], methodName: r[1] || vt, arguments: [], lineNumber: +r[3], column: r[4] ? +r[4] : null } : null;
    }
    var oo = class {
      getLocation() {
        return null;
      }
    };
    var so = class {
      _error;
      constructor() {
        this._error = new Error();
      }
      getLocation() {
        let r = this._error.stack;
        if (!r) return null;
        let n = La(r).find((i) => {
          if (!i.file) return false;
          let o = Li(i.file);
          return o !== "<anonymous>" && !o.includes("@prisma") && !o.includes("/packages/client/src/runtime/") && !o.endsWith("/runtime/binary.js") && !o.endsWith("/runtime/library.js") && !o.endsWith("/runtime/edge.js") && !o.endsWith("/runtime/edge-esm.js") && !o.startsWith("internal/") && !i.methodName.includes("new ") && !i.methodName.includes("getCallSite") && !i.methodName.includes("Proxy.") && i.methodName.split(".").length < 4;
        });
        return !n || !n.file ? null : { fileName: n.file, lineNumber: n.lineNumber, columnNumber: n.column };
      }
    };
    function Ze(e) {
      return e === "minimal" ? typeof $EnabledCallSite == "function" && e !== "minimal" ? new $EnabledCallSite() : new oo() : new so();
    }
    var Fa = { _avg: true, _count: true, _sum: true, _min: true, _max: true };
    function qr(e = {}) {
      let r = Pm(e);
      return Object.entries(r).reduce((n, [i, o]) => (Fa[i] !== void 0 ? n.select[i] = { select: o } : n[i] = o, n), { select: {} });
    }
    function Pm(e = {}) {
      return typeof e._count == "boolean" ? { ...e, _count: { _all: e._count } } : e;
    }
    function Un(e = {}) {
      return (r) => (typeof e._count == "boolean" && (r._count = r._count._all), r);
    }
    function Ma(e, r) {
      let t = Un(e);
      return r({ action: "aggregate", unpacker: t, argsMapper: qr })(e);
    }
    function Tm(e = {}) {
      let { select: r, ...t } = e;
      return typeof r == "object" ? qr({ ...t, _count: r }) : qr({ ...t, _count: { _all: true } });
    }
    function Sm(e = {}) {
      return typeof e.select == "object" ? (r) => Un(e)(r)._count : (r) => Un(e)(r)._count._all;
    }
    function $a(e, r) {
      return r({ action: "count", unpacker: Sm(e), argsMapper: Tm })(e);
    }
    function Rm(e = {}) {
      let r = qr(e);
      if (Array.isArray(r.by)) for (let t of r.by) typeof t == "string" && (r.select[t] = true);
      else typeof r.by == "string" && (r.select[r.by] = true);
      return r;
    }
    function Am(e = {}) {
      return (r) => (typeof e?._count == "boolean" && r.forEach((t) => {
        t._count = t._count._all;
      }), r);
    }
    function qa(e, r) {
      return r({ action: "groupBy", unpacker: Am(e), argsMapper: Rm })(e);
    }
    function Va(e, r, t) {
      if (r === "aggregate") return (n) => Ma(n, t);
      if (r === "count") return (n) => $a(n, t);
      if (r === "groupBy") return (n) => qa(n, t);
    }
    function ja(e, r) {
      let t = r.fields.filter((i) => !i.relationName), n = _s(t, "name");
      return new Proxy({}, { get(i, o) {
        if (o in i || typeof o == "symbol") return i[o];
        let s = n[o];
        if (s) return new mt(e, o, s.type, s.isList, s.kind === "enum");
      }, ...Bn(Object.keys(n)) });
    }
    var Ba = (e) => Array.isArray(e) ? e : e.split(".");
    var ao = (e, r) => Ba(r).reduce((t, n) => t && t[n], e);
    var Ua = (e, r, t) => Ba(r).reduceRight((n, i, o, s) => Object.assign({}, ao(e, s.slice(0, o)), { [i]: n }), t);
    function Cm(e, r) {
      return e === void 0 || r === void 0 ? [] : [...r, "select", e];
    }
    function Im(e, r, t) {
      return r === void 0 ? e ?? {} : Ua(r, t, e || true);
    }
    function lo(e, r, t, n, i, o) {
      let a = e._runtimeDataModel.models[r].fields.reduce((l, u) => ({ ...l, [u.name]: u }), {});
      return (l) => {
        let u = Ze(e._errorFormat), c = Cm(n, i), p = Im(l, o, c), d = t({ dataPath: c, callsite: u })(p), f = Dm(e, r);
        return new Proxy(d, { get(h, g) {
          if (!f.includes(g)) return h[g];
          let T = [a[g].type, t, g], S = [c, p];
          return lo(e, ...T, ...S);
        }, ...Bn([...f, ...Object.getOwnPropertyNames(d)]) });
      };
    }
    function Dm(e, r) {
      return e._runtimeDataModel.models[r].fields.filter((t) => t.kind === "object").map((t) => t.name);
    }
    var Om = ["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "create", "update", "upsert", "delete"];
    var km = ["aggregate", "count", "groupBy"];
    function uo(e, r) {
      let t = e._extensions.getAllModelExtensions(r) ?? {}, n = [_m(e, r), Lm(e, r), xt(t), re("name", () => r), re("$name", () => r), re("$parent", () => e._appliedParent)];
      return he({}, n);
    }
    function _m(e, r) {
      let t = Te(r), n = Object.keys(Rr).concat("count");
      return { getKeys() {
        return n;
      }, getPropertyValue(i) {
        let o = i, s = (a) => (l) => {
          let u = Ze(e._errorFormat);
          return e._createPrismaPromise((c) => {
            let p = { args: l, dataPath: [], action: o, model: r, clientMethod: `${t}.${i}`, jsModelName: t, transaction: c, callsite: u };
            return e._request({ ...p, ...a });
          }, { action: o, args: l, model: r });
        };
        return Om.includes(o) ? lo(e, r, s) : Nm(i) ? Va(e, i, s) : s({});
      } };
    }
    function Nm(e) {
      return km.includes(e);
    }
    function Lm(e, r) {
      return lr(re("fields", () => {
        let t = e._runtimeDataModel.models[r];
        return ja(r, t);
      }));
    }
    function Ga(e) {
      return e.replace(/^./, (r) => r.toUpperCase());
    }
    var co = Symbol();
    function Pt(e) {
      let r = [Fm(e), Mm(e), re(co, () => e), re("$parent", () => e._appliedParent)], t = e._extensions.getAllClientExtensions();
      return t && r.push(xt(t)), he(e, r);
    }
    function Fm(e) {
      let r = Object.getPrototypeOf(e._originalClient), t = [...new Set(Object.getOwnPropertyNames(r))];
      return { getKeys() {
        return t;
      }, getPropertyValue(n) {
        return e[n];
      } };
    }
    function Mm(e) {
      let r = Object.keys(e._runtimeDataModel.models), t = r.map(Te), n = [...new Set(r.concat(t))];
      return lr({ getKeys() {
        return n;
      }, getPropertyValue(i) {
        let o = Ga(i);
        if (e._runtimeDataModel.models[o] !== void 0) return uo(e, o);
        if (e._runtimeDataModel.models[i] !== void 0) return uo(e, i);
      }, getPropertyDescriptor(i) {
        if (!t.includes(i)) return { enumerable: false };
      } });
    }
    function Qa(e) {
      return e[co] ? e[co] : e;
    }
    function Wa(e) {
      if (typeof e == "function") return e(this);
      if (e.client?.__AccelerateEngine) {
        let t = e.client.__AccelerateEngine;
        this._originalClient._engine = new t(this._originalClient._accelerateEngineConfig);
      }
      let r = Object.create(this._originalClient, { _extensions: { value: this._extensions.append(e) }, _appliedParent: { value: this, configurable: true }, $on: { value: void 0 } });
      return Pt(r);
    }
    function Ja({ result: e, modelName: r, select: t, omit: n, extensions: i }) {
      let o = i.getAllComputedFields(r);
      if (!o) return e;
      let s = [], a = [];
      for (let l of Object.values(o)) {
        if (n) {
          if (n[l.name]) continue;
          let u = l.needs.filter((c) => n[c]);
          u.length > 0 && a.push(Fr(u));
        } else if (t) {
          if (!t[l.name]) continue;
          let u = l.needs.filter((c) => !t[c]);
          u.length > 0 && a.push(Fr(u));
        }
        $m(e, l.needs) && s.push(qm(l, he(e, s)));
      }
      return s.length > 0 || a.length > 0 ? he(e, [...s, ...a]) : e;
    }
    function $m(e, r) {
      return r.every((t) => Vi(e, t));
    }
    function qm(e, r) {
      return lr(re(e.name, () => e.compute(r)));
    }
    function Gn({ visitor: e, result: r, args: t, runtimeDataModel: n, modelName: i }) {
      if (Array.isArray(r)) {
        for (let s = 0; s < r.length; s++) r[s] = Gn({ result: r[s], args: t, modelName: i, runtimeDataModel: n, visitor: e });
        return r;
      }
      let o = e(r, i, t) ?? r;
      return t.include && Ka({ includeOrSelect: t.include, result: o, parentModelName: i, runtimeDataModel: n, visitor: e }), t.select && Ka({ includeOrSelect: t.select, result: o, parentModelName: i, runtimeDataModel: n, visitor: e }), o;
    }
    function Ka({ includeOrSelect: e, result: r, parentModelName: t, runtimeDataModel: n, visitor: i }) {
      for (let [o, s] of Object.entries(e)) {
        if (!s || r[o] == null || Se(s)) continue;
        let l = n.models[t].fields.find((c) => c.name === o);
        if (!l || l.kind !== "object" || !l.relationName) continue;
        let u = typeof s == "object" ? s : {};
        r[o] = Gn({ visitor: i, result: r[o], args: u, modelName: l.type, runtimeDataModel: n });
      }
    }
    function Ha({ result: e, modelName: r, args: t, extensions: n, runtimeDataModel: i, globalOmit: o }) {
      return n.isEmpty() || e == null || typeof e != "object" || !i.models[r] ? e : Gn({ result: e, args: t ?? {}, modelName: r, runtimeDataModel: i, visitor: (a, l, u) => {
        let c = Te(l);
        return Ja({ result: a, modelName: c, select: u.select, omit: u.select ? void 0 : { ...o?.[c], ...u.omit }, extensions: n });
      } });
    }
    var Vm = ["$connect", "$disconnect", "$on", "$transaction", "$extends"];
    var Ya = Vm;
    function za(e) {
      if (e instanceof ie) return jm(e);
      if (Vn(e)) return Bm(e);
      if (Array.isArray(e)) {
        let t = [e[0]];
        for (let n = 1; n < e.length; n++) t[n] = Tt(e[n]);
        return t;
      }
      let r = {};
      for (let t in e) r[t] = Tt(e[t]);
      return r;
    }
    function jm(e) {
      return new ie(e.strings, e.values);
    }
    function Bm(e) {
      return new wt(e.sql, e.values);
    }
    function Tt(e) {
      if (typeof e != "object" || e == null || e instanceof Me || kr(e)) return e;
      if (Sr(e)) return new Fe(e.toFixed());
      if (vr(e)) return /* @__PURE__ */ new Date(+e);
      if (ArrayBuffer.isView(e)) return e.slice(0);
      if (Array.isArray(e)) {
        let r = e.length, t;
        for (t = Array(r); r--; ) t[r] = Tt(e[r]);
        return t;
      }
      if (typeof e == "object") {
        let r = {};
        for (let t in e) t === "__proto__" ? Object.defineProperty(r, t, { value: Tt(e[t]), configurable: true, enumerable: true, writable: true }) : r[t] = Tt(e[t]);
        return r;
      }
      ar(e, "Unknown value");
    }
    function Xa(e, r, t, n = 0) {
      return e._createPrismaPromise((i) => {
        let o = r.customDataProxyFetch;
        return "transaction" in r && i !== void 0 && (r.transaction?.kind === "batch" && r.transaction.lock.then(), r.transaction = i), n === t.length ? e._executeRequest(r) : t[n]({ model: r.model, operation: r.model ? r.action : r.clientMethod, args: za(r.args ?? {}), __internalParams: r, query: (s, a = r) => {
          let l = a.customDataProxyFetch;
          return a.customDataProxyFetch = nl(o, l), a.args = s, Xa(e, a, t, n + 1);
        } });
      });
    }
    function el(e, r) {
      let { jsModelName: t, action: n, clientMethod: i } = r, o = t ? n : i;
      if (e._extensions.isEmpty()) return e._executeRequest(r);
      let s = e._extensions.getAllQueryCallbacks(t ?? "$none", o);
      return Xa(e, r, s);
    }
    function rl(e) {
      return (r) => {
        let t = { requests: r }, n = r[0].extensions.getAllBatchQueryCallbacks();
        return n.length ? tl(t, n, 0, e) : e(t);
      };
    }
    function tl(e, r, t, n) {
      if (t === r.length) return n(e);
      let i = e.customDataProxyFetch, o = e.requests[0].transaction;
      return r[t]({ args: { queries: e.requests.map((s) => ({ model: s.modelName, operation: s.action, args: s.args })), transaction: o ? { isolationLevel: o.kind === "batch" ? o.isolationLevel : void 0 } : void 0 }, __internalParams: e, query(s, a = e) {
        let l = a.customDataProxyFetch;
        return a.customDataProxyFetch = nl(i, l), tl(a, r, t + 1, n);
      } });
    }
    var Za = (e) => e;
    function nl(e = Za, r = Za) {
      return (t) => e(r(t));
    }
    var il = N("prisma:client");
    var ol = { Vercel: "vercel", "Netlify CI": "netlify" };
    function sl({ postinstall: e, ciName: r, clientVersion: t, generator: n }) {
      if (il("checkPlatformCaching:postinstall", e), il("checkPlatformCaching:ciName", r), e === true && !(n?.output && typeof (n.output.fromEnvVar ?? n.output.value) == "string") && r && r in ol) {
        let i = `Prisma has detected that this project was built on ${r}, which caches dependencies. This leads to an outdated Prisma Client because Prisma's auto-generation isn't triggered. To fix this, make sure to run the \`prisma generate\` command during the build process.

Learn how: https://pris.ly/d/${ol[r]}-build`;
        throw console.error(i), new P(i, t);
      }
    }
    function al(e, r) {
      return e ? e.datasources ? e.datasources : e.datasourceUrl ? { [r[0]]: { url: e.datasourceUrl } } : {} : {};
    }
    var dl = O(require("node:fs"));
    var St = O(require("node:path"));
    function Qn(e) {
      let { runtimeBinaryTarget: r } = e;
      return `Add "${r}" to \`binaryTargets\` in the "schema.prisma" file and run \`prisma generate\` after saving it:

${Um(e)}`;
    }
    function Um(e) {
      let { generator: r, generatorBinaryTargets: t, runtimeBinaryTarget: n } = e, i = { fromEnvVar: null, value: n }, o = [...t, i];
      return ki({ ...r, binaryTargets: o });
    }
    function Xe(e) {
      let { runtimeBinaryTarget: r } = e;
      return `Prisma Client could not locate the Query Engine for runtime "${r}".`;
    }
    function er(e) {
      let { searchedLocations: r } = e;
      return `The following locations have been searched:
${[...new Set(r)].map((i) => `  ${i}`).join(`
`)}`;
    }
    function ll(e) {
      let { runtimeBinaryTarget: r } = e;
      return `${Xe(e)}

This happened because \`binaryTargets\` have been pinned, but the actual deployment also required "${r}".
${Qn(e)}

${er(e)}`;
    }
    function Wn(e) {
      return `We would appreciate if you could take the time to share some information with us.
Please help us by answering a few questions: https://pris.ly/${e}`;
    }
    function Jn(e) {
      let { errorStack: r } = e;
      return r?.match(/\/\.next|\/next@|\/next\//) ? `

We detected that you are using Next.js, learn how to fix this: https://pris.ly/d/engine-not-found-nextjs.` : "";
    }
    function ul(e) {
      let { queryEngineName: r } = e;
      return `${Xe(e)}${Jn(e)}

This is likely caused by a bundler that has not copied "${r}" next to the resulting bundle.
Ensure that "${r}" has been copied next to the bundle or in "${e.expectedLocation}".

${Wn("engine-not-found-bundler-investigation")}

${er(e)}`;
    }
    function cl(e) {
      let { runtimeBinaryTarget: r, generatorBinaryTargets: t } = e, n = t.find((i) => i.native);
      return `${Xe(e)}

This happened because Prisma Client was generated for "${n?.value ?? "unknown"}", but the actual deployment required "${r}".
${Qn(e)}

${er(e)}`;
    }
    function pl(e) {
      let { queryEngineName: r } = e;
      return `${Xe(e)}${Jn(e)}

This is likely caused by tooling that has not copied "${r}" to the deployment folder.
Ensure that you ran \`prisma generate\` and that "${r}" has been copied to "${e.expectedLocation}".

${Wn("engine-not-found-tooling-investigation")}

${er(e)}`;
    }
    var Gm = N("prisma:client:engines:resolveEnginePath");
    var Qm = () => new RegExp("runtime[\\\\/]library\\.m?js$");
    async function ml(e, r) {
      let t = { binary: process.env.PRISMA_QUERY_ENGINE_BINARY, library: process.env.PRISMA_QUERY_ENGINE_LIBRARY }[e] ?? r.prismaPath;
      if (t !== void 0) return t;
      let { enginePath: n, searchedLocations: i } = await Wm(e, r);
      if (Gm("enginePath", n), n !== void 0 && e === "binary" && Ri(n), n !== void 0) return r.prismaPath = n;
      let o = await ir(), s = r.generator?.binaryTargets ?? [], a = s.some((d) => d.native), l = !s.some((d) => d.value === o), u = __filename.match(Qm()) === null, c = { searchedLocations: i, generatorBinaryTargets: s, generator: r.generator, runtimeBinaryTarget: o, queryEngineName: fl(e, o), expectedLocation: St.default.relative(process.cwd(), r.dirname), errorStack: new Error().stack }, p;
      throw a && l ? p = cl(c) : l ? p = ll(c) : u ? p = ul(c) : p = pl(c), new P(p, r.clientVersion);
    }
    async function Wm(e, r) {
      let t = await ir(), n = [], i = [r.dirname, St.default.resolve(__dirname, ".."), r.generator?.output?.value ?? __dirname, St.default.resolve(__dirname, "../../../.prisma/client"), "/tmp/prisma-engines", r.cwd];
      __filename.includes("resolveEnginePath") && i.push(ms());
      for (let o of i) {
        let s = fl(e, t), a = St.default.join(o, s);
        if (n.push(o), dl.default.existsSync(a)) return { enginePath: a, searchedLocations: n };
      }
      return { enginePath: void 0, searchedLocations: n };
    }
    function fl(e, r) {
      return e === "library" ? Gt(r, "fs") : `query-engine-${r}${r === "windows" ? ".exe" : ""}`;
    }
    function gl(e) {
      return e ? e.replace(/".*"/g, '"X"').replace(/[\s:\[]([+-]?([0-9]*[.])?[0-9]+)/g, (r) => `${r[0]}5`) : "";
    }
    function hl(e) {
      return e.split(`
`).map((r) => r.replace(/^\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z)\s*/, "").replace(/\+\d+\s*ms$/, "")).join(`
`);
    }
    var yl = O(Os());
    function bl({ title: e, user: r = "prisma", repo: t = "prisma", template: n = "bug_report.yml", body: i }) {
      return (0, yl.default)({ user: r, repo: t, template: n, title: e, body: i });
    }
    function El({ version: e, binaryTarget: r, title: t, description: n, engineVersion: i, database: o, query: s }) {
      let a = Bo(6e3 - (s?.length ?? 0)), l = hl(wr(a)), u = n ? `# Description
\`\`\`
${n}
\`\`\`` : "", c = wr(`Hi Prisma Team! My Prisma Client just crashed. This is the report:
## Versions

| Name            | Version            |
|-----------------|--------------------|
| Node            | ${process.version?.padEnd(19)}| 
| OS              | ${r?.padEnd(19)}|
| Prisma Client   | ${e?.padEnd(19)}|
| Query Engine    | ${i?.padEnd(19)}|
| Database        | ${o?.padEnd(19)}|

${u}

## Logs
\`\`\`
${l}
\`\`\`

## Client Snippet
\`\`\`ts
// PLEASE FILL YOUR CODE SNIPPET HERE
\`\`\`

## Schema
\`\`\`prisma
// PLEASE ADD YOUR SCHEMA HERE IF POSSIBLE
\`\`\`

## Prisma Engine Query
\`\`\`
${s ? gl(s) : ""}
\`\`\`
`), p = bl({ title: t, body: c });
      return `${t}

This is a non-recoverable error which probably happens when the Prisma Query Engine has a panic.

${Y(p)}

If you want the Prisma team to look into it, please open the link above \u{1F64F}
To increase the chance of success, please post your schema and a snippet of
how you used Prisma Client in the issue. 
`;
    }
    function wl(e, r) {
      throw new Error(r);
    }
    function Jm(e) {
      return e !== null && typeof e == "object" && typeof e.$type == "string";
    }
    function Km(e, r) {
      let t = {};
      for (let n of Object.keys(e)) t[n] = r(e[n], n);
      return t;
    }
    function Vr(e) {
      return e === null ? e : Array.isArray(e) ? e.map(Vr) : typeof e == "object" ? Jm(e) ? Hm(e) : e.constructor !== null && e.constructor.name !== "Object" ? e : Km(e, Vr) : e;
    }
    function Hm({ $type: e, value: r }) {
      switch (e) {
        case "BigInt":
          return BigInt(r);
        case "Bytes": {
          let { buffer: t, byteOffset: n, byteLength: i } = Buffer.from(r, "base64");
          return new Uint8Array(t, n, i);
        }
        case "DateTime":
          return new Date(r);
        case "Decimal":
          return new Le(r);
        case "Json":
          return JSON.parse(r);
        default:
          wl(r, "Unknown tagged value");
      }
    }
    var xl = "6.19.2";
    var zm = () => globalThis.process?.release?.name === "node";
    var Zm = () => !!globalThis.Bun || !!globalThis.process?.versions?.bun;
    var Xm = () => !!globalThis.Deno;
    var ef = () => typeof globalThis.Netlify == "object";
    var rf = () => typeof globalThis.EdgeRuntime == "object";
    var tf = () => globalThis.navigator?.userAgent === "Cloudflare-Workers";
    function nf() {
      return [[ef, "netlify"], [rf, "edge-light"], [tf, "workerd"], [Xm, "deno"], [Zm, "bun"], [zm, "node"]].flatMap((t) => t[0]() ? [t[1]] : []).at(0) ?? "";
    }
    var of = { node: "Node.js", workerd: "Cloudflare Workers", deno: "Deno and Deno Deploy", netlify: "Netlify Edge Functions", "edge-light": "Edge Runtime (Vercel Edge Functions, Vercel Edge Middleware, Next.js (Pages Router) Edge API Routes, Next.js (App Router) Edge Route Handlers or Next.js Middleware)" };
    function Kn() {
      let e = nf();
      return { id: e, prettyName: of[e] || e, isEdge: ["workerd", "deno", "netlify", "edge-light"].includes(e) };
    }
    function jr({ inlineDatasources: e, overrideDatasources: r, env: t, clientVersion: n }) {
      let i, o = Object.keys(e)[0], s = e[o]?.url, a = r[o]?.url;
      if (o === void 0 ? i = void 0 : a ? i = a : s?.value ? i = s.value : s?.fromEnvVar && (i = t[s.fromEnvVar]), s?.fromEnvVar !== void 0 && i === void 0) throw new P(`error: Environment variable not found: ${s.fromEnvVar}.`, n);
      if (i === void 0) throw new P("error: Missing URL environment variable, value, or override.", n);
      return i;
    }
    var Hn = class extends Error {
      clientVersion;
      cause;
      constructor(r, t) {
        super(r), this.clientVersion = t.clientVersion, this.cause = t.cause;
      }
      get [Symbol.toStringTag]() {
        return this.name;
      }
    };
    var oe = class extends Hn {
      isRetryable;
      constructor(r, t) {
        super(r, t), this.isRetryable = t.isRetryable ?? true;
      }
    };
    function R(e, r) {
      return { ...e, isRetryable: r };
    }
    var ur = class extends oe {
      name = "InvalidDatasourceError";
      code = "P6001";
      constructor(r, t) {
        super(r, R(t, false));
      }
    };
    x(ur, "InvalidDatasourceError");
    function vl(e) {
      let r = { clientVersion: e.clientVersion }, t = Object.keys(e.inlineDatasources)[0], n = jr({ inlineDatasources: e.inlineDatasources, overrideDatasources: e.overrideDatasources, clientVersion: e.clientVersion, env: { ...e.env, ...typeof process < "u" ? process.env : {} } }), i;
      try {
        i = new URL(n);
      } catch {
        throw new ur(`Error validating datasource \`${t}\`: the URL must start with the protocol \`prisma://\``, r);
      }
      let { protocol: o, searchParams: s } = i;
      if (o !== "prisma:" && o !== sn) throw new ur(`Error validating datasource \`${t}\`: the URL must start with the protocol \`prisma://\` or \`prisma+postgres://\``, r);
      let a = s.get("api_key");
      if (a === null || a.length < 1) throw new ur(`Error validating datasource \`${t}\`: the URL must contain a valid API key`, r);
      let l = Ii(i) ? "http:" : "https:";
      process.env.TEST_CLIENT_ENGINE_REMOTE_EXECUTOR && i.searchParams.has("use_http") && (l = "http:");
      let u = new URL(i.href.replace(o, l));
      return { apiKey: a, url: u };
    }
    var Pl = O(on());
    var Yn = class {
      apiKey;
      tracingHelper;
      logLevel;
      logQueries;
      engineHash;
      constructor({ apiKey: r, tracingHelper: t, logLevel: n, logQueries: i, engineHash: o }) {
        this.apiKey = r, this.tracingHelper = t, this.logLevel = n, this.logQueries = i, this.engineHash = o;
      }
      build({ traceparent: r, transactionId: t } = {}) {
        let n = { Accept: "application/json", Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", "Prisma-Engine-Hash": this.engineHash, "Prisma-Engine-Version": Pl.enginesVersion };
        this.tracingHelper.isEnabled() && (n.traceparent = r ?? this.tracingHelper.getTraceParent()), t && (n["X-Transaction-Id"] = t);
        let i = this.#e();
        return i.length > 0 && (n["X-Capture-Telemetry"] = i.join(", ")), n;
      }
      #e() {
        let r = [];
        return this.tracingHelper.isEnabled() && r.push("tracing"), this.logLevel && r.push(this.logLevel), this.logQueries && r.push("query"), r;
      }
    };
    function sf(e) {
      return e[0] * 1e3 + e[1] / 1e6;
    }
    function po(e) {
      return new Date(sf(e));
    }
    var Br = class extends oe {
      name = "ForcedRetryError";
      code = "P5001";
      constructor(r) {
        super("This request must be retried", R(r, true));
      }
    };
    x(Br, "ForcedRetryError");
    var cr = class extends oe {
      name = "NotImplementedYetError";
      code = "P5004";
      constructor(r, t) {
        super(r, R(t, false));
      }
    };
    x(cr, "NotImplementedYetError");
    var $ = class extends oe {
      response;
      constructor(r, t) {
        super(r, t), this.response = t.response;
        let n = this.response.headers.get("prisma-request-id");
        if (n) {
          let i = `(The request id was: ${n})`;
          this.message = this.message + " " + i;
        }
      }
    };
    var pr = class extends $ {
      name = "SchemaMissingError";
      code = "P5005";
      constructor(r) {
        super("Schema needs to be uploaded", R(r, true));
      }
    };
    x(pr, "SchemaMissingError");
    var mo = "This request could not be understood by the server";
    var Rt = class extends $ {
      name = "BadRequestError";
      code = "P5000";
      constructor(r, t, n) {
        super(t || mo, R(r, false)), n && (this.code = n);
      }
    };
    x(Rt, "BadRequestError");
    var At = class extends $ {
      name = "HealthcheckTimeoutError";
      code = "P5013";
      logs;
      constructor(r, t) {
        super("Engine not started: healthcheck timeout", R(r, true)), this.logs = t;
      }
    };
    x(At, "HealthcheckTimeoutError");
    var Ct = class extends $ {
      name = "EngineStartupError";
      code = "P5014";
      logs;
      constructor(r, t, n) {
        super(t, R(r, true)), this.logs = n;
      }
    };
    x(Ct, "EngineStartupError");
    var It = class extends $ {
      name = "EngineVersionNotSupportedError";
      code = "P5012";
      constructor(r) {
        super("Engine version is not supported", R(r, false));
      }
    };
    x(It, "EngineVersionNotSupportedError");
    var fo = "Request timed out";
    var Dt = class extends $ {
      name = "GatewayTimeoutError";
      code = "P5009";
      constructor(r, t = fo) {
        super(t, R(r, false));
      }
    };
    x(Dt, "GatewayTimeoutError");
    var af = "Interactive transaction error";
    var Ot = class extends $ {
      name = "InteractiveTransactionError";
      code = "P5015";
      constructor(r, t = af) {
        super(t, R(r, false));
      }
    };
    x(Ot, "InteractiveTransactionError");
    var lf = "Request parameters are invalid";
    var kt = class extends $ {
      name = "InvalidRequestError";
      code = "P5011";
      constructor(r, t = lf) {
        super(t, R(r, false));
      }
    };
    x(kt, "InvalidRequestError");
    var go = "Requested resource does not exist";
    var _t = class extends $ {
      name = "NotFoundError";
      code = "P5003";
      constructor(r, t = go) {
        super(t, R(r, false));
      }
    };
    x(_t, "NotFoundError");
    var ho = "Unknown server error";
    var Ur = class extends $ {
      name = "ServerError";
      code = "P5006";
      logs;
      constructor(r, t, n) {
        super(t || ho, R(r, true)), this.logs = n;
      }
    };
    x(Ur, "ServerError");
    var yo = "Unauthorized, check your connection string";
    var Nt = class extends $ {
      name = "UnauthorizedError";
      code = "P5007";
      constructor(r, t = yo) {
        super(t, R(r, false));
      }
    };
    x(Nt, "UnauthorizedError");
    var bo = "Usage exceeded, retry again later";
    var Lt = class extends $ {
      name = "UsageExceededError";
      code = "P5008";
      constructor(r, t = bo) {
        super(t, R(r, true));
      }
    };
    x(Lt, "UsageExceededError");
    async function uf(e) {
      let r;
      try {
        r = await e.text();
      } catch {
        return { type: "EmptyError" };
      }
      try {
        let t = JSON.parse(r);
        if (typeof t == "string") switch (t) {
          case "InternalDataProxyError":
            return { type: "DataProxyError", body: t };
          default:
            return { type: "UnknownTextError", body: t };
        }
        if (typeof t == "object" && t !== null) {
          if ("is_panic" in t && "message" in t && "error_code" in t) return { type: "QueryEngineError", body: t };
          if ("EngineNotStarted" in t || "InteractiveTransactionMisrouted" in t || "InvalidRequestError" in t) {
            let n = Object.values(t)[0].reason;
            return typeof n == "string" && !["SchemaMissing", "EngineVersionNotSupported"].includes(n) ? { type: "UnknownJsonError", body: t } : { type: "DataProxyError", body: t };
          }
        }
        return { type: "UnknownJsonError", body: t };
      } catch {
        return r === "" ? { type: "EmptyError" } : { type: "UnknownTextError", body: r };
      }
    }
    async function Ft(e, r) {
      if (e.ok) return;
      let t = { clientVersion: r, response: e }, n = await uf(e);
      if (n.type === "QueryEngineError") throw new z2(n.body.message, { code: n.body.error_code, clientVersion: r });
      if (n.type === "DataProxyError") {
        if (n.body === "InternalDataProxyError") throw new Ur(t, "Internal Data Proxy error");
        if ("EngineNotStarted" in n.body) {
          if (n.body.EngineNotStarted.reason === "SchemaMissing") return new pr(t);
          if (n.body.EngineNotStarted.reason === "EngineVersionNotSupported") throw new It(t);
          if ("EngineStartupError" in n.body.EngineNotStarted.reason) {
            let { msg: i, logs: o } = n.body.EngineNotStarted.reason.EngineStartupError;
            throw new Ct(t, i, o);
          }
          if ("KnownEngineStartupError" in n.body.EngineNotStarted.reason) {
            let { msg: i, error_code: o } = n.body.EngineNotStarted.reason.KnownEngineStartupError;
            throw new P(i, r, o);
          }
          if ("HealthcheckTimeout" in n.body.EngineNotStarted.reason) {
            let { logs: i } = n.body.EngineNotStarted.reason.HealthcheckTimeout;
            throw new At(t, i);
          }
        }
        if ("InteractiveTransactionMisrouted" in n.body) {
          let i = { IDParseError: "Could not parse interactive transaction ID", NoQueryEngineFoundError: "Could not find Query Engine for the specified host and transaction ID", TransactionStartError: "Could not start interactive transaction" };
          throw new Ot(t, i[n.body.InteractiveTransactionMisrouted.reason]);
        }
        if ("InvalidRequestError" in n.body) throw new kt(t, n.body.InvalidRequestError.reason);
      }
      if (e.status === 401 || e.status === 403) throw new Nt(t, Gr(yo, n));
      if (e.status === 404) return new _t(t, Gr(go, n));
      if (e.status === 429) throw new Lt(t, Gr(bo, n));
      if (e.status === 504) throw new Dt(t, Gr(fo, n));
      if (e.status >= 500) throw new Ur(t, Gr(ho, n));
      if (e.status >= 400) throw new Rt(t, Gr(mo, n));
    }
    function Gr(e, r) {
      return r.type === "EmptyError" ? e : `${e}: ${JSON.stringify(r)}`;
    }
    function Tl(e) {
      let r = Math.pow(2, e) * 50, t = Math.ceil(Math.random() * r) - Math.ceil(r / 2), n = r + t;
      return new Promise((i) => setTimeout(() => i(n), n));
    }
    var $e = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    function Sl(e) {
      let r = new TextEncoder().encode(e), t = "", n = r.byteLength, i = n % 3, o = n - i, s, a, l, u, c;
      for (let p = 0; p < o; p = p + 3) c = r[p] << 16 | r[p + 1] << 8 | r[p + 2], s = (c & 16515072) >> 18, a = (c & 258048) >> 12, l = (c & 4032) >> 6, u = c & 63, t += $e[s] + $e[a] + $e[l] + $e[u];
      return i == 1 ? (c = r[o], s = (c & 252) >> 2, a = (c & 3) << 4, t += $e[s] + $e[a] + "==") : i == 2 && (c = r[o] << 8 | r[o + 1], s = (c & 64512) >> 10, a = (c & 1008) >> 4, l = (c & 15) << 2, t += $e[s] + $e[a] + $e[l] + "="), t;
    }
    function Rl(e) {
      if (!!e.generator?.previewFeatures.some((t) => t.toLowerCase().includes("metrics"))) throw new P("The `metrics` preview feature is not yet available with Accelerate.\nPlease remove `metrics` from the `previewFeatures` in your schema.\n\nMore information about Accelerate: https://pris.ly/d/accelerate", e.clientVersion);
    }
    var Al = { "@prisma/debug": "workspace:*", "@prisma/engines-version": "7.1.1-3.c2990dca591cba766e3b7ef5d9e8a84796e47ab7", "@prisma/fetch-engine": "workspace:*", "@prisma/get-platform": "workspace:*" };
    var Mt = class extends oe {
      name = "RequestError";
      code = "P5010";
      constructor(r, t) {
        super(`Cannot fetch data from service:
${r}`, R(t, true));
      }
    };
    x(Mt, "RequestError");
    async function dr(e, r, t = (n) => n) {
      let { clientVersion: n, ...i } = r, o = t(fetch);
      try {
        return await o(e, i);
      } catch (s) {
        let a = s.message ?? "Unknown error";
        throw new Mt(a, { clientVersion: n, cause: s });
      }
    }
    var pf = /^[1-9][0-9]*\.[0-9]+\.[0-9]+$/;
    var Cl = N("prisma:client:dataproxyEngine");
    async function df(e, r) {
      let t = Al["@prisma/engines-version"], n = r.clientVersion ?? "unknown";
      if (process.env.PRISMA_CLIENT_DATA_PROXY_CLIENT_VERSION || globalThis.PRISMA_CLIENT_DATA_PROXY_CLIENT_VERSION) return process.env.PRISMA_CLIENT_DATA_PROXY_CLIENT_VERSION || globalThis.PRISMA_CLIENT_DATA_PROXY_CLIENT_VERSION;
      if (e.includes("accelerate") && n !== "0.0.0" && n !== "in-memory") return n;
      let [i, o] = n?.split("-") ?? [];
      if (o === void 0 && pf.test(i)) return i;
      if (o !== void 0 || n === "0.0.0" || n === "in-memory") {
        let [s] = t.split("-") ?? [], [a, l, u] = s.split("."), c = mf(`<=${a}.${l}.${u}`), p = await dr(c, { clientVersion: n });
        if (!p.ok) throw new Error(`Failed to fetch stable Prisma version, unpkg.com status ${p.status} ${p.statusText}, response body: ${await p.text() || "<empty body>"}`);
        let d = await p.text();
        Cl("length of body fetched from unpkg.com", d.length);
        let f;
        try {
          f = JSON.parse(d);
        } catch (h) {
          throw console.error("JSON.parse error: body fetched from unpkg.com: ", d), h;
        }
        return f.version;
      }
      throw new cr("Only `major.minor.patch` versions are supported by Accelerate.", { clientVersion: n });
    }
    async function Il(e, r) {
      let t = await df(e, r);
      return Cl("version", t), t;
    }
    function mf(e) {
      return encodeURI(`https://unpkg.com/prisma@${e}/package.json`);
    }
    var Dl = 3;
    var $t = N("prisma:client:dataproxyEngine");
    var qt = class {
      name = "DataProxyEngine";
      inlineSchema;
      inlineSchemaHash;
      inlineDatasources;
      config;
      logEmitter;
      env;
      clientVersion;
      engineHash;
      tracingHelper;
      remoteClientVersion;
      host;
      headerBuilder;
      startPromise;
      protocol;
      constructor(r) {
        Rl(r), this.config = r, this.env = r.env, this.inlineSchema = Sl(r.inlineSchema), this.inlineDatasources = r.inlineDatasources, this.inlineSchemaHash = r.inlineSchemaHash, this.clientVersion = r.clientVersion, this.engineHash = r.engineVersion, this.logEmitter = r.logEmitter, this.tracingHelper = r.tracingHelper;
      }
      apiKey() {
        return this.headerBuilder.apiKey;
      }
      version() {
        return this.engineHash;
      }
      async start() {
        this.startPromise !== void 0 && await this.startPromise, this.startPromise = (async () => {
          let { apiKey: r, url: t } = this.getURLAndAPIKey();
          this.host = t.host, this.protocol = t.protocol, this.headerBuilder = new Yn({ apiKey: r, tracingHelper: this.tracingHelper, logLevel: this.config.logLevel ?? "error", logQueries: this.config.logQueries, engineHash: this.engineHash }), this.remoteClientVersion = await Il(this.host, this.config), $t("host", this.host), $t("protocol", this.protocol);
        })(), await this.startPromise;
      }
      async stop() {
      }
      propagateResponseExtensions(r) {
        r?.logs?.length && r.logs.forEach((t) => {
          switch (t.level) {
            case "debug":
            case "trace":
              $t(t);
              break;
            case "error":
            case "warn":
            case "info": {
              this.logEmitter.emit(t.level, { timestamp: po(t.timestamp), message: t.attributes.message ?? "", target: t.target ?? "BinaryEngine" });
              break;
            }
            case "query": {
              this.logEmitter.emit("query", { query: t.attributes.query ?? "", timestamp: po(t.timestamp), duration: t.attributes.duration_ms ?? 0, params: t.attributes.params ?? "", target: t.target ?? "BinaryEngine" });
              break;
            }
            default:
              t.level;
          }
        }), r?.traces?.length && this.tracingHelper.dispatchEngineSpans(r.traces);
      }
      onBeforeExit() {
        throw new Error('"beforeExit" hook is not applicable to the remote query engine');
      }
      async url(r) {
        return await this.start(), `${this.protocol}//${this.host}/${this.remoteClientVersion}/${this.inlineSchemaHash}/${r}`;
      }
      async uploadSchema() {
        let r = { name: "schemaUpload", internal: true };
        return this.tracingHelper.runInChildSpan(r, async () => {
          let t = await dr(await this.url("schema"), { method: "PUT", headers: this.headerBuilder.build(), body: this.inlineSchema, clientVersion: this.clientVersion });
          t.ok || $t("schema response status", t.status);
          let n = await Ft(t, this.clientVersion);
          if (n) throw this.logEmitter.emit("warn", { message: `Error while uploading schema: ${n.message}`, timestamp: /* @__PURE__ */ new Date(), target: "" }), n;
          this.logEmitter.emit("info", { message: `Schema (re)uploaded (hash: ${this.inlineSchemaHash})`, timestamp: /* @__PURE__ */ new Date(), target: "" });
        });
      }
      request(r, { traceparent: t, interactiveTransaction: n, customDataProxyFetch: i }) {
        return this.requestInternal({ body: r, traceparent: t, interactiveTransaction: n, customDataProxyFetch: i });
      }
      async requestBatch(r, { traceparent: t, transaction: n, customDataProxyFetch: i }) {
        let o = n?.kind === "itx" ? n.options : void 0, s = Mr(r, n);
        return (await this.requestInternal({ body: s, customDataProxyFetch: i, interactiveTransaction: o, traceparent: t })).map((l) => (l.extensions && this.propagateResponseExtensions(l.extensions), "errors" in l ? this.convertProtocolErrorsToClientError(l.errors) : l));
      }
      requestInternal({ body: r, traceparent: t, customDataProxyFetch: n, interactiveTransaction: i }) {
        return this.withRetry({ actionGerund: "querying", callback: async ({ logHttpCall: o }) => {
          let s = i ? `${i.payload.endpoint}/graphql` : await this.url("graphql");
          o(s);
          let a = await dr(s, { method: "POST", headers: this.headerBuilder.build({ traceparent: t, transactionId: i?.id }), body: JSON.stringify(r), clientVersion: this.clientVersion }, n);
          a.ok || $t("graphql response status", a.status), await this.handleError(await Ft(a, this.clientVersion));
          let l = await a.json();
          if (l.extensions && this.propagateResponseExtensions(l.extensions), "errors" in l) throw this.convertProtocolErrorsToClientError(l.errors);
          return "batchResult" in l ? l.batchResult : l;
        } });
      }
      async transaction(r, t, n) {
        let i = { start: "starting", commit: "committing", rollback: "rolling back" };
        return this.withRetry({ actionGerund: `${i[r]} transaction`, callback: async ({ logHttpCall: o }) => {
          if (r === "start") {
            let s = JSON.stringify({ max_wait: n.maxWait, timeout: n.timeout, isolation_level: n.isolationLevel }), a = await this.url("transaction/start");
            o(a);
            let l = await dr(a, { method: "POST", headers: this.headerBuilder.build({ traceparent: t.traceparent }), body: s, clientVersion: this.clientVersion });
            await this.handleError(await Ft(l, this.clientVersion));
            let u = await l.json(), { extensions: c } = u;
            c && this.propagateResponseExtensions(c);
            let p = u.id, d = u["data-proxy"].endpoint;
            return { id: p, payload: { endpoint: d } };
          } else {
            let s = `${n.payload.endpoint}/${r}`;
            o(s);
            let a = await dr(s, { method: "POST", headers: this.headerBuilder.build({ traceparent: t.traceparent }), clientVersion: this.clientVersion });
            await this.handleError(await Ft(a, this.clientVersion));
            let l = await a.json(), { extensions: u } = l;
            u && this.propagateResponseExtensions(u);
            return;
          }
        } });
      }
      getURLAndAPIKey() {
        return vl({ clientVersion: this.clientVersion, env: this.env, inlineDatasources: this.inlineDatasources, overrideDatasources: this.config.overrideDatasources });
      }
      metrics() {
        throw new cr("Metrics are not yet supported for Accelerate", { clientVersion: this.clientVersion });
      }
      async withRetry(r) {
        for (let t = 0; ; t++) {
          let n = (i) => {
            this.logEmitter.emit("info", { message: `Calling ${i} (n=${t})`, timestamp: /* @__PURE__ */ new Date(), target: "" });
          };
          try {
            return await r.callback({ logHttpCall: n });
          } catch (i) {
            if (!(i instanceof oe) || !i.isRetryable) throw i;
            if (t >= Dl) throw i instanceof Br ? i.cause : i;
            this.logEmitter.emit("warn", { message: `Attempt ${t + 1}/${Dl} failed for ${r.actionGerund}: ${i.message ?? "(unknown)"}`, timestamp: /* @__PURE__ */ new Date(), target: "" });
            let o = await Tl(t);
            this.logEmitter.emit("warn", { message: `Retrying after ${o}ms`, timestamp: /* @__PURE__ */ new Date(), target: "" });
          }
        }
      }
      async handleError(r) {
        if (r instanceof pr) throw await this.uploadSchema(), new Br({ clientVersion: this.clientVersion, cause: r });
        if (r) throw r;
      }
      convertProtocolErrorsToClientError(r) {
        return r.length === 1 ? $r(r[0], this.config.clientVersion, this.config.activeProvider) : new V(JSON.stringify(r), { clientVersion: this.config.clientVersion });
      }
      applyPendingMigrations() {
        throw new Error("Method not implemented.");
      }
    };
    function Ol(e) {
      if (e?.kind === "itx") return e.options.id;
    }
    var wo = O(require("node:os"));
    var kl = O(require("node:path"));
    var Eo = Symbol("PrismaLibraryEngineCache");
    function ff() {
      let e = globalThis;
      return e[Eo] === void 0 && (e[Eo] = {}), e[Eo];
    }
    function gf(e) {
      let r = ff();
      if (r[e] !== void 0) return r[e];
      let t = kl.default.toNamespacedPath(e), n = { exports: {} }, i = 0;
      return process.platform !== "win32" && (i = wo.default.constants.dlopen.RTLD_LAZY | wo.default.constants.dlopen.RTLD_DEEPBIND), process.dlopen(n, t, i), r[e] = n.exports, n.exports;
    }
    var _l = { async loadLibrary(e) {
      let r = await fi(), t = await ml("library", e);
      try {
        return e.tracingHelper.runInChildSpan({ name: "loadLibrary", internal: true }, () => gf(t));
      } catch (n) {
        let i = Ai({ e: n, platformInfo: r, id: t });
        throw new P(i, e.clientVersion);
      }
    } };
    var xo;
    var Nl = { async loadLibrary(e) {
      let { clientVersion: r, adapter: t, engineWasm: n } = e;
      if (t === void 0) throw new P(`The \`adapter\` option for \`PrismaClient\` is required in this context (${Kn().prettyName})`, r);
      if (n === void 0) throw new P("WASM engine was unexpectedly `undefined`", r);
      xo === void 0 && (xo = (async () => {
        let o = await n.getRuntime(), s = await n.getQueryEngineWasmModule();
        if (s == null) throw new P("The loaded wasm module was unexpectedly `undefined` or `null` once loaded", r);
        let a = { "./query_engine_bg.js": o }, l = new WebAssembly.Instance(s, a), u = l.exports.__wbindgen_start;
        return o.__wbg_set_wasm(l.exports), u(), o.QueryEngine;
      })());
      let i = await xo;
      return { debugPanic() {
        return Promise.reject("{}");
      }, dmmf() {
        return Promise.resolve("{}");
      }, version() {
        return { commit: "unknown", version: "unknown" };
      }, QueryEngine: i };
    } };
    var hf = "P2036";
    var Re = N("prisma:client:libraryEngine");
    function yf(e) {
      return e.item_type === "query" && "query" in e;
    }
    function bf(e) {
      return "level" in e ? e.level === "error" && e.message === "PANIC" : false;
    }
    var Ll = [...li, "native"];
    var Ef = 0xffffffffffffffffn;
    var vo = 1n;
    function wf() {
      let e = vo++;
      return vo > Ef && (vo = 1n), e;
    }
    var Qr = class {
      name = "LibraryEngine";
      engine;
      libraryInstantiationPromise;
      libraryStartingPromise;
      libraryStoppingPromise;
      libraryStarted;
      executingQueryPromise;
      config;
      QueryEngineConstructor;
      libraryLoader;
      library;
      logEmitter;
      libQueryEnginePath;
      binaryTarget;
      datasourceOverrides;
      datamodel;
      logQueries;
      logLevel;
      lastQuery;
      loggerRustPanic;
      tracingHelper;
      adapterPromise;
      versionInfo;
      constructor(r, t) {
        this.libraryLoader = t ?? _l, r.engineWasm !== void 0 && (this.libraryLoader = t ?? Nl), this.config = r, this.libraryStarted = false, this.logQueries = r.logQueries ?? false, this.logLevel = r.logLevel ?? "error", this.logEmitter = r.logEmitter, this.datamodel = r.inlineSchema, this.tracingHelper = r.tracingHelper, r.enableDebugLogs && (this.logLevel = "debug");
        let n = Object.keys(r.overrideDatasources)[0], i = r.overrideDatasources[n]?.url;
        n !== void 0 && i !== void 0 && (this.datasourceOverrides = { [n]: i }), this.libraryInstantiationPromise = this.instantiateLibrary();
      }
      wrapEngine(r) {
        return { applyPendingMigrations: r.applyPendingMigrations?.bind(r), commitTransaction: this.withRequestId(r.commitTransaction.bind(r)), connect: this.withRequestId(r.connect.bind(r)), disconnect: this.withRequestId(r.disconnect.bind(r)), metrics: r.metrics?.bind(r), query: this.withRequestId(r.query.bind(r)), rollbackTransaction: this.withRequestId(r.rollbackTransaction.bind(r)), sdlSchema: r.sdlSchema?.bind(r), startTransaction: this.withRequestId(r.startTransaction.bind(r)), trace: r.trace.bind(r), free: r.free?.bind(r) };
      }
      withRequestId(r) {
        return async (...t) => {
          let n = wf().toString();
          try {
            return await r(...t, n);
          } finally {
            if (this.tracingHelper.isEnabled()) {
              let i = await this.engine?.trace(n);
              if (i) {
                let o = JSON.parse(i);
                this.tracingHelper.dispatchEngineSpans(o.spans);
              }
            }
          }
        };
      }
      async applyPendingMigrations() {
        throw new Error("Cannot call this method from this type of engine instance");
      }
      async transaction(r, t, n) {
        await this.start();
        let i = await this.adapterPromise, o = JSON.stringify(t), s;
        if (r === "start") {
          let l = JSON.stringify({ max_wait: n.maxWait, timeout: n.timeout, isolation_level: n.isolationLevel });
          s = await this.engine?.startTransaction(l, o);
        } else r === "commit" ? s = await this.engine?.commitTransaction(n.id, o) : r === "rollback" && (s = await this.engine?.rollbackTransaction(n.id, o));
        let a = this.parseEngineResponse(s);
        if (xf(a)) {
          let l = this.getExternalAdapterError(a, i?.errorRegistry);
          throw l ? l.error : new z2(a.message, { code: a.error_code, clientVersion: this.config.clientVersion, meta: a.meta });
        } else if (typeof a.message == "string") throw new V(a.message, { clientVersion: this.config.clientVersion });
        return a;
      }
      async instantiateLibrary() {
        if (Re("internalSetup"), this.libraryInstantiationPromise) return this.libraryInstantiationPromise;
        ai(), this.binaryTarget = await this.getCurrentBinaryTarget(), await this.tracingHelper.runInChildSpan("load_engine", () => this.loadEngine()), this.version();
      }
      async getCurrentBinaryTarget() {
        {
          if (this.binaryTarget) return this.binaryTarget;
          let r = await this.tracingHelper.runInChildSpan("detect_platform", () => ir());
          if (!Ll.includes(r)) throw new P(`Unknown ${ce("PRISMA_QUERY_ENGINE_LIBRARY")} ${ce(W(r))}. Possible binaryTargets: ${qe(Ll.join(", "))} or a path to the query engine library.
You may have to run ${qe("prisma generate")} for your changes to take effect.`, this.config.clientVersion);
          return r;
        }
      }
      parseEngineResponse(r) {
        if (!r) throw new V("Response from the Engine was empty", { clientVersion: this.config.clientVersion });
        try {
          return JSON.parse(r);
        } catch {
          throw new V("Unable to JSON.parse response from engine", { clientVersion: this.config.clientVersion });
        }
      }
      async loadEngine() {
        if (!this.engine) {
          this.QueryEngineConstructor || (this.library = await this.libraryLoader.loadLibrary(this.config), this.QueryEngineConstructor = this.library.QueryEngine);
          try {
            let r = new WeakRef(this);
            this.adapterPromise || (this.adapterPromise = this.config.adapter?.connect()?.then(tn));
            let t = await this.adapterPromise;
            t && Re("Using driver adapter: %O", t), this.engine = this.wrapEngine(new this.QueryEngineConstructor({ datamodel: this.datamodel, env: process.env, logQueries: this.config.logQueries ?? false, ignoreEnvVarErrors: true, datasourceOverrides: this.datasourceOverrides ?? {}, logLevel: this.logLevel, configDir: this.config.cwd, engineProtocol: "json", enableTracing: this.tracingHelper.isEnabled() }, (n) => {
              r.deref()?.logger(n);
            }, t));
          } catch (r) {
            let t = r, n = this.parseInitError(t.message);
            throw typeof n == "string" ? t : new P(n.message, this.config.clientVersion, n.error_code);
          }
        }
      }
      logger(r) {
        let t = this.parseEngineResponse(r);
        t && (t.level = t?.level.toLowerCase() ?? "unknown", yf(t) ? this.logEmitter.emit("query", { timestamp: /* @__PURE__ */ new Date(), query: t.query, params: t.params, duration: Number(t.duration_ms), target: t.module_path }) : bf(t) ? this.loggerRustPanic = new ae(Po(this, `${t.message}: ${t.reason} in ${t.file}:${t.line}:${t.column}`), this.config.clientVersion) : this.logEmitter.emit(t.level, { timestamp: /* @__PURE__ */ new Date(), message: t.message, target: t.module_path }));
      }
      parseInitError(r) {
        try {
          return JSON.parse(r);
        } catch {
        }
        return r;
      }
      parseRequestError(r) {
        try {
          return JSON.parse(r);
        } catch {
        }
        return r;
      }
      onBeforeExit() {
        throw new Error('"beforeExit" hook is not applicable to the library engine since Prisma 5.0.0, it is only relevant and implemented for the binary engine. Please add your event listener to the `process` object directly instead.');
      }
      async start() {
        if (this.libraryInstantiationPromise || (this.libraryInstantiationPromise = this.instantiateLibrary()), await this.libraryInstantiationPromise, await this.libraryStoppingPromise, this.libraryStartingPromise) return Re(`library already starting, this.libraryStarted: ${this.libraryStarted}`), this.libraryStartingPromise;
        if (this.libraryStarted) return;
        let r = async () => {
          Re("library starting");
          try {
            let t = { traceparent: this.tracingHelper.getTraceParent() };
            await this.engine?.connect(JSON.stringify(t)), this.libraryStarted = true, this.adapterPromise || (this.adapterPromise = this.config.adapter?.connect()?.then(tn)), await this.adapterPromise, Re("library started");
          } catch (t) {
            let n = this.parseInitError(t.message);
            throw typeof n == "string" ? t : new P(n.message, this.config.clientVersion, n.error_code);
          } finally {
            this.libraryStartingPromise = void 0;
          }
        };
        return this.libraryStartingPromise = this.tracingHelper.runInChildSpan("connect", r), this.libraryStartingPromise;
      }
      async stop() {
        if (await this.libraryInstantiationPromise, await this.libraryStartingPromise, await this.executingQueryPromise, this.libraryStoppingPromise) return Re("library is already stopping"), this.libraryStoppingPromise;
        if (!this.libraryStarted) {
          await (await this.adapterPromise)?.dispose(), this.adapterPromise = void 0;
          return;
        }
        let r = async () => {
          await new Promise((n) => setImmediate(n)), Re("library stopping");
          let t = { traceparent: this.tracingHelper.getTraceParent() };
          await this.engine?.disconnect(JSON.stringify(t)), this.engine?.free && this.engine.free(), this.engine = void 0, this.libraryStarted = false, this.libraryStoppingPromise = void 0, this.libraryInstantiationPromise = void 0, await (await this.adapterPromise)?.dispose(), this.adapterPromise = void 0, Re("library stopped");
        };
        return this.libraryStoppingPromise = this.tracingHelper.runInChildSpan("disconnect", r), this.libraryStoppingPromise;
      }
      version() {
        return this.versionInfo = this.library?.version(), this.versionInfo?.version ?? "unknown";
      }
      debugPanic(r) {
        return this.library?.debugPanic(r);
      }
      async request(r, { traceparent: t, interactiveTransaction: n }) {
        Re(`sending request, this.libraryStarted: ${this.libraryStarted}`);
        let i = JSON.stringify({ traceparent: t }), o = JSON.stringify(r);
        try {
          await this.start();
          let s = await this.adapterPromise;
          this.executingQueryPromise = this.engine?.query(o, i, n?.id), this.lastQuery = o;
          let a = this.parseEngineResponse(await this.executingQueryPromise);
          if (a.errors) throw a.errors.length === 1 ? this.buildQueryError(a.errors[0], s?.errorRegistry) : new V(JSON.stringify(a.errors), { clientVersion: this.config.clientVersion });
          if (this.loggerRustPanic) throw this.loggerRustPanic;
          return { data: a };
        } catch (s) {
          if (s instanceof P) throw s;
          if (s.code === "GenericFailure" && s.message?.startsWith("PANIC:")) throw new ae(Po(this, s.message), this.config.clientVersion);
          let a = this.parseRequestError(s.message);
          throw typeof a == "string" ? s : new V(`${a.message}
${a.backtrace}`, { clientVersion: this.config.clientVersion });
        }
      }
      async requestBatch(r, { transaction: t, traceparent: n }) {
        Re("requestBatch");
        let i = Mr(r, t);
        await this.start();
        let o = await this.adapterPromise;
        this.lastQuery = JSON.stringify(i), this.executingQueryPromise = this.engine?.query(this.lastQuery, JSON.stringify({ traceparent: n }), Ol(t));
        let s = await this.executingQueryPromise, a = this.parseEngineResponse(s);
        if (a.errors) throw a.errors.length === 1 ? this.buildQueryError(a.errors[0], o?.errorRegistry) : new V(JSON.stringify(a.errors), { clientVersion: this.config.clientVersion });
        let { batchResult: l, errors: u } = a;
        if (Array.isArray(l)) return l.map((c) => c.errors && c.errors.length > 0 ? this.loggerRustPanic ?? this.buildQueryError(c.errors[0], o?.errorRegistry) : { data: c });
        throw u && u.length === 1 ? new Error(u[0].error) : new Error(JSON.stringify(a));
      }
      buildQueryError(r, t) {
        if (r.user_facing_error.is_panic) return new ae(Po(this, r.user_facing_error.message), this.config.clientVersion);
        let n = this.getExternalAdapterError(r.user_facing_error, t);
        return n ? n.error : $r(r, this.config.clientVersion, this.config.activeProvider);
      }
      getExternalAdapterError(r, t) {
        if (r.error_code === hf && t) {
          let n = r.meta?.id;
          ln(typeof n == "number", "Malformed external JS error received from the engine");
          let i = t.consumeError(n);
          return ln(i, "External error with reported id was not registered"), i;
        }
      }
      async metrics(r) {
        await this.start();
        let t = await this.engine.metrics(JSON.stringify(r));
        return r.format === "prometheus" ? t : this.parseEngineResponse(t);
      }
    };
    function xf(e) {
      return typeof e == "object" && e !== null && e.error_code !== void 0;
    }
    function Po(e, r) {
      return El({ binaryTarget: e.binaryTarget, title: r, version: e.config.clientVersion, engineVersion: e.versionInfo?.commit, database: e.config.activeProvider, query: e.lastQuery });
    }
    function Fl({ url: e, adapter: r, copyEngine: t, targetBuildType: n }) {
      let i = [], o = [], s = (g) => {
        i.push({ _tag: "warning", value: g });
      }, a = (g) => {
        let I = g.join(`
`);
        o.push({ _tag: "error", value: I });
      }, l = !!e?.startsWith("prisma://"), u = an(e), c = !!r, p = l || u;
      !c && t && p && n !== "client" && n !== "wasm-compiler-edge" && s(["recommend--no-engine", "In production, we recommend using `prisma generate --no-engine` (See: `prisma generate --help`)"]);
      let d = p || !t;
      c && (d || n === "edge") && (n === "edge" ? a(["Prisma Client was configured to use the `adapter` option but it was imported via its `/edge` endpoint.", "Please either remove the `/edge` endpoint or remove the `adapter` from the Prisma Client constructor."]) : p ? a(["You've provided both a driver adapter and an Accelerate database URL. Driver adapters currently cannot connect to Accelerate.", "Please provide either a driver adapter with a direct database URL or an Accelerate URL and no driver adapter."]) : t || a(["Prisma Client was configured to use the `adapter` option but `prisma generate` was run with `--no-engine`.", "Please run `prisma generate` without `--no-engine` to be able to use Prisma Client with the adapter."]));
      let f = { accelerate: d, ppg: u, driverAdapters: c };
      function h(g) {
        return g.length > 0;
      }
      return h(o) ? { ok: false, diagnostics: { warnings: i, errors: o }, isUsing: f } : { ok: true, diagnostics: { warnings: i }, isUsing: f };
    }
    function Ml({ copyEngine: e = true }, r) {
      let t;
      try {
        t = jr({ inlineDatasources: r.inlineDatasources, overrideDatasources: r.overrideDatasources, env: { ...r.env, ...process.env }, clientVersion: r.clientVersion });
      } catch {
      }
      let { ok: n, isUsing: i, diagnostics: o } = Fl({ url: t, adapter: r.adapter, copyEngine: e, targetBuildType: "library" });
      for (let p of o.warnings) at(...p.value);
      if (!n) {
        let p = o.errors[0];
        throw new Z(p.value, { clientVersion: r.clientVersion });
      }
      let s = Er(r.generator), a = s === "library", l = s === "binary", u = s === "client", c = (i.accelerate || i.ppg) && !i.driverAdapters;
      return i.accelerate ? new qt(r) : (i.driverAdapters, a ? new Qr(r) : new Qr(r));
    }
    function $l({ generator: e }) {
      return e?.previewFeatures ?? [];
    }
    var ql = (e) => ({ command: e });
    var Vl = (e) => e.strings.reduce((r, t, n) => `${r}@P${n}${t}`);
    function Wr(e) {
      try {
        return jl(e, "fast");
      } catch {
        return jl(e, "slow");
      }
    }
    function jl(e, r) {
      return JSON.stringify(e.map((t) => Ul(t, r)));
    }
    function Ul(e, r) {
      if (Array.isArray(e)) return e.map((t) => Ul(t, r));
      if (typeof e == "bigint") return { prisma__type: "bigint", prisma__value: e.toString() };
      if (vr(e)) return { prisma__type: "date", prisma__value: e.toJSON() };
      if (Fe.isDecimal(e)) return { prisma__type: "decimal", prisma__value: e.toJSON() };
      if (Buffer.isBuffer(e)) return { prisma__type: "bytes", prisma__value: e.toString("base64") };
      if (vf(e)) return { prisma__type: "bytes", prisma__value: Buffer.from(e).toString("base64") };
      if (ArrayBuffer.isView(e)) {
        let { buffer: t, byteOffset: n, byteLength: i } = e;
        return { prisma__type: "bytes", prisma__value: Buffer.from(t, n, i).toString("base64") };
      }
      return typeof e == "object" && r === "slow" ? Gl(e) : e;
    }
    function vf(e) {
      return e instanceof ArrayBuffer || e instanceof SharedArrayBuffer ? true : typeof e == "object" && e !== null ? e[Symbol.toStringTag] === "ArrayBuffer" || e[Symbol.toStringTag] === "SharedArrayBuffer" : false;
    }
    function Gl(e) {
      if (typeof e != "object" || e === null) return e;
      if (typeof e.toJSON == "function") return e.toJSON();
      if (Array.isArray(e)) return e.map(Bl);
      let r = {};
      for (let t of Object.keys(e)) r[t] = Bl(e[t]);
      return r;
    }
    function Bl(e) {
      return typeof e == "bigint" ? e.toString() : Gl(e);
    }
    var Pf = /^(\s*alter\s)/i;
    var Ql = N("prisma:client");
    function To(e, r, t, n) {
      if (!(e !== "postgresql" && e !== "cockroachdb") && t.length > 0 && Pf.exec(r)) throw new Error(`Running ALTER using ${n} is not supported
Using the example below you can still execute your query with Prisma, but please note that it is vulnerable to SQL injection attacks and requires you to take care of input sanitization.

Example:
  await prisma.$executeRawUnsafe(\`ALTER USER prisma WITH PASSWORD '\${password}'\`)

More Information: https://pris.ly/d/execute-raw
`);
    }
    var So = ({ clientMethod: e, activeProvider: r }) => (t) => {
      let n = "", i;
      if (Vn(t)) n = t.sql, i = { values: Wr(t.values), __prismaRawParameters__: true };
      else if (Array.isArray(t)) {
        let [o, ...s] = t;
        n = o, i = { values: Wr(s || []), __prismaRawParameters__: true };
      } else switch (r) {
        case "sqlite":
        case "mysql": {
          n = t.sql, i = { values: Wr(t.values), __prismaRawParameters__: true };
          break;
        }
        case "cockroachdb":
        case "postgresql":
        case "postgres": {
          n = t.text, i = { values: Wr(t.values), __prismaRawParameters__: true };
          break;
        }
        case "sqlserver": {
          n = Vl(t), i = { values: Wr(t.values), __prismaRawParameters__: true };
          break;
        }
        default:
          throw new Error(`The ${r} provider does not support ${e}`);
      }
      return i?.values ? Ql(`prisma.${e}(${n}, ${i.values})`) : Ql(`prisma.${e}(${n})`), { query: n, parameters: i };
    };
    var Wl = { requestArgsToMiddlewareArgs(e) {
      return [e.strings, ...e.values];
    }, middlewareArgsToRequestArgs(e) {
      let [r, ...t] = e;
      return new ie(r, t);
    } };
    var Jl = { requestArgsToMiddlewareArgs(e) {
      return [e];
    }, middlewareArgsToRequestArgs(e) {
      return e[0];
    } };
    function Ro(e) {
      return function(t, n) {
        let i, o = (s = e) => {
          try {
            return s === void 0 || s?.kind === "itx" ? i ??= Kl(t(s)) : Kl(t(s));
          } catch (a) {
            return Promise.reject(a);
          }
        };
        return { get spec() {
          return n;
        }, then(s, a) {
          return o().then(s, a);
        }, catch(s) {
          return o().catch(s);
        }, finally(s) {
          return o().finally(s);
        }, requestTransaction(s) {
          let a = o(s);
          return a.requestTransaction ? a.requestTransaction(s) : a;
        }, [Symbol.toStringTag]: "PrismaPromise" };
      };
    }
    function Kl(e) {
      return typeof e.then == "function" ? e : Promise.resolve(e);
    }
    var Tf = xi.split(".")[0];
    var Sf = { isEnabled() {
      return false;
    }, getTraceParent() {
      return "00-10-10-00";
    }, dispatchEngineSpans() {
    }, getActiveContext() {
    }, runInChildSpan(e, r) {
      return r();
    } };
    var Ao = class {
      isEnabled() {
        return this.getGlobalTracingHelper().isEnabled();
      }
      getTraceParent(r) {
        return this.getGlobalTracingHelper().getTraceParent(r);
      }
      dispatchEngineSpans(r) {
        return this.getGlobalTracingHelper().dispatchEngineSpans(r);
      }
      getActiveContext() {
        return this.getGlobalTracingHelper().getActiveContext();
      }
      runInChildSpan(r, t) {
        return this.getGlobalTracingHelper().runInChildSpan(r, t);
      }
      getGlobalTracingHelper() {
        let r = globalThis[`V${Tf}_PRISMA_INSTRUMENTATION`], t = globalThis.PRISMA_INSTRUMENTATION;
        return r?.helper ?? t?.helper ?? Sf;
      }
    };
    function Hl() {
      return new Ao();
    }
    function Yl(e, r = () => {
    }) {
      let t, n = new Promise((i) => t = i);
      return { then(i) {
        return --e === 0 && t(r()), i?.(n);
      } };
    }
    function zl(e) {
      return typeof e == "string" ? e : e.reduce((r, t) => {
        let n = typeof t == "string" ? t : t.level;
        return n === "query" ? r : r && (t === "info" || r === "info") ? "info" : n;
      }, void 0);
    }
    function zn(e) {
      return typeof e.batchRequestIdx == "number";
    }
    function Zl(e) {
      if (e.action !== "findUnique" && e.action !== "findUniqueOrThrow") return;
      let r = [];
      return e.modelName && r.push(e.modelName), e.query.arguments && r.push(Co(e.query.arguments)), r.push(Co(e.query.selection)), r.join("");
    }
    function Co(e) {
      return `(${Object.keys(e).sort().map((t) => {
        let n = e[t];
        return typeof n == "object" && n !== null ? `(${t} ${Co(n)})` : t;
      }).join(" ")})`;
    }
    var Rf = { aggregate: false, aggregateRaw: false, createMany: true, createManyAndReturn: true, createOne: true, deleteMany: true, deleteOne: true, executeRaw: true, findFirst: false, findFirstOrThrow: false, findMany: false, findRaw: false, findUnique: false, findUniqueOrThrow: false, groupBy: false, queryRaw: false, runCommandRaw: true, updateMany: true, updateManyAndReturn: true, updateOne: true, upsertOne: true };
    function Io(e) {
      return Rf[e];
    }
    var Zn = class {
      constructor(r) {
        this.options = r;
        this.batches = {};
      }
      batches;
      tickActive = false;
      request(r) {
        let t = this.options.batchBy(r);
        return t ? (this.batches[t] || (this.batches[t] = [], this.tickActive || (this.tickActive = true, process.nextTick(() => {
          this.dispatchBatches(), this.tickActive = false;
        }))), new Promise((n, i) => {
          this.batches[t].push({ request: r, resolve: n, reject: i });
        })) : this.options.singleLoader(r);
      }
      dispatchBatches() {
        for (let r in this.batches) {
          let t = this.batches[r];
          delete this.batches[r], t.length === 1 ? this.options.singleLoader(t[0].request).then((n) => {
            n instanceof Error ? t[0].reject(n) : t[0].resolve(n);
          }).catch((n) => {
            t[0].reject(n);
          }) : (t.sort((n, i) => this.options.batchOrder(n.request, i.request)), this.options.batchLoader(t.map((n) => n.request)).then((n) => {
            if (n instanceof Error) for (let i = 0; i < t.length; i++) t[i].reject(n);
            else for (let i = 0; i < t.length; i++) {
              let o = n[i];
              o instanceof Error ? t[i].reject(o) : t[i].resolve(o);
            }
          }).catch((n) => {
            for (let i = 0; i < t.length; i++) t[i].reject(n);
          }));
        }
      }
      get [Symbol.toStringTag]() {
        return "DataLoader";
      }
    };
    function mr(e, r) {
      if (r === null) return r;
      switch (e) {
        case "bigint":
          return BigInt(r);
        case "bytes": {
          let { buffer: t, byteOffset: n, byteLength: i } = Buffer.from(r, "base64");
          return new Uint8Array(t, n, i);
        }
        case "decimal":
          return new Fe(r);
        case "datetime":
        case "date":
          return new Date(r);
        case "time":
          return /* @__PURE__ */ new Date(`1970-01-01T${r}Z`);
        case "bigint-array":
          return r.map((t) => mr("bigint", t));
        case "bytes-array":
          return r.map((t) => mr("bytes", t));
        case "decimal-array":
          return r.map((t) => mr("decimal", t));
        case "datetime-array":
          return r.map((t) => mr("datetime", t));
        case "date-array":
          return r.map((t) => mr("date", t));
        case "time-array":
          return r.map((t) => mr("time", t));
        default:
          return r;
      }
    }
    function Xn(e) {
      let r = [], t = Af(e);
      for (let n = 0; n < e.rows.length; n++) {
        let i = e.rows[n], o = { ...t };
        for (let s = 0; s < i.length; s++) o[e.columns[s]] = mr(e.types[s], i[s]);
        r.push(o);
      }
      return r;
    }
    function Af(e) {
      let r = {};
      for (let t = 0; t < e.columns.length; t++) r[e.columns[t]] = null;
      return r;
    }
    var Cf = N("prisma:client:request_handler");
    var ei = class {
      client;
      dataloader;
      logEmitter;
      constructor(r, t) {
        this.logEmitter = t, this.client = r, this.dataloader = new Zn({ batchLoader: rl(async ({ requests: n, customDataProxyFetch: i }) => {
          let { transaction: o, otelParentCtx: s } = n[0], a = n.map((p) => p.protocolQuery), l = this.client._tracingHelper.getTraceParent(s), u = n.some((p) => Io(p.protocolQuery.action));
          return (await this.client._engine.requestBatch(a, { traceparent: l, transaction: If(o), containsWrite: u, customDataProxyFetch: i })).map((p, d) => {
            if (p instanceof Error) return p;
            try {
              return this.mapQueryEngineResult(n[d], p);
            } catch (f) {
              return f;
            }
          });
        }), singleLoader: async (n) => {
          let i = n.transaction?.kind === "itx" ? Xl(n.transaction) : void 0, o = await this.client._engine.request(n.protocolQuery, { traceparent: this.client._tracingHelper.getTraceParent(), interactiveTransaction: i, isWrite: Io(n.protocolQuery.action), customDataProxyFetch: n.customDataProxyFetch });
          return this.mapQueryEngineResult(n, o);
        }, batchBy: (n) => n.transaction?.id ? `transaction-${n.transaction.id}` : Zl(n.protocolQuery), batchOrder(n, i) {
          return n.transaction?.kind === "batch" && i.transaction?.kind === "batch" ? n.transaction.index - i.transaction.index : 0;
        } });
      }
      async request(r) {
        try {
          return await this.dataloader.request(r);
        } catch (t) {
          let { clientMethod: n, callsite: i, transaction: o, args: s, modelName: a } = r;
          this.handleAndLogRequestError({ error: t, clientMethod: n, callsite: i, transaction: o, args: s, modelName: a, globalOmit: r.globalOmit });
        }
      }
      mapQueryEngineResult({ dataPath: r, unpacker: t }, n) {
        let i = n?.data, o = this.unpack(i, r, t);
        return process.env.PRISMA_CLIENT_GET_TIME ? { data: o } : o;
      }
      handleAndLogRequestError(r) {
        try {
          this.handleRequestError(r);
        } catch (t) {
          throw this.logEmitter && this.logEmitter.emit("error", { message: t.message, target: r.clientMethod, timestamp: /* @__PURE__ */ new Date() }), t;
        }
      }
      handleRequestError({ error: r, clientMethod: t, callsite: n, transaction: i, args: o, modelName: s, globalOmit: a }) {
        if (Cf(r), Df(r, i)) throw r;
        if (r instanceof z2 && Of(r)) {
          let u = eu(r.meta);
          Nn({ args: o, errors: [u], callsite: n, errorFormat: this.client._errorFormat, originalMethod: t, clientVersion: this.client._clientVersion, globalOmit: a });
        }
        let l = r.message;
        if (n && (l = Tn({ callsite: n, originalMethod: t, isPanic: r.isPanic, showColors: this.client._errorFormat === "pretty", message: l })), l = this.sanitizeMessage(l), r.code) {
          let u = s ? { modelName: s, ...r.meta } : r.meta;
          throw new z2(l, { code: r.code, clientVersion: this.client._clientVersion, meta: u, batchRequestIdx: r.batchRequestIdx });
        } else {
          if (r.isPanic) throw new ae(l, this.client._clientVersion);
          if (r instanceof V) throw new V(l, { clientVersion: this.client._clientVersion, batchRequestIdx: r.batchRequestIdx });
          if (r instanceof P) throw new P(l, this.client._clientVersion);
          if (r instanceof ae) throw new ae(l, this.client._clientVersion);
        }
        throw r.clientVersion = this.client._clientVersion, r;
      }
      sanitizeMessage(r) {
        return this.client._errorFormat && this.client._errorFormat !== "pretty" ? wr(r) : r;
      }
      unpack(r, t, n) {
        if (!r || (r.data && (r = r.data), !r)) return r;
        let i = Object.keys(r)[0], o = Object.values(r)[0], s = t.filter((u) => u !== "select" && u !== "include"), a = ao(o, s), l = i === "queryRaw" ? Xn(a) : Vr(a);
        return n ? n(l) : l;
      }
      get [Symbol.toStringTag]() {
        return "RequestHandler";
      }
    };
    function If(e) {
      if (e) {
        if (e.kind === "batch") return { kind: "batch", options: { isolationLevel: e.isolationLevel } };
        if (e.kind === "itx") return { kind: "itx", options: Xl(e) };
        ar(e, "Unknown transaction kind");
      }
    }
    function Xl(e) {
      return { id: e.id, payload: e.payload };
    }
    function Df(e, r) {
      return zn(e) && r?.kind === "batch" && e.batchRequestIdx !== r.index;
    }
    function Of(e) {
      return e.code === "P2009" || e.code === "P2012";
    }
    function eu(e) {
      if (e.kind === "Union") return { kind: "Union", errors: e.errors.map(eu) };
      if (Array.isArray(e.selectionPath)) {
        let [, ...r] = e.selectionPath;
        return { ...e, selectionPath: r };
      }
      return e;
    }
    var ru = xl;
    var su = O(Ki());
    var _ = class extends Error {
      constructor(r) {
        super(r + `
Read more at https://pris.ly/d/client-constructor`), this.name = "PrismaClientConstructorValidationError";
      }
      get [Symbol.toStringTag]() {
        return "PrismaClientConstructorValidationError";
      }
    };
    x(_, "PrismaClientConstructorValidationError");
    var tu = ["datasources", "datasourceUrl", "errorFormat", "adapter", "log", "transactionOptions", "omit", "__internal"];
    var nu = ["pretty", "colorless", "minimal"];
    var iu = ["info", "query", "warn", "error"];
    var kf = { datasources: (e, { datasourceNames: r }) => {
      if (e) {
        if (typeof e != "object" || Array.isArray(e)) throw new _(`Invalid value ${JSON.stringify(e)} for "datasources" provided to PrismaClient constructor`);
        for (let [t, n] of Object.entries(e)) {
          if (!r.includes(t)) {
            let i = Jr(t, r) || ` Available datasources: ${r.join(", ")}`;
            throw new _(`Unknown datasource ${t} provided to PrismaClient constructor.${i}`);
          }
          if (typeof n != "object" || Array.isArray(n)) throw new _(`Invalid value ${JSON.stringify(e)} for datasource "${t}" provided to PrismaClient constructor.
It should have this form: { url: "CONNECTION_STRING" }`);
          if (n && typeof n == "object") for (let [i, o] of Object.entries(n)) {
            if (i !== "url") throw new _(`Invalid value ${JSON.stringify(e)} for datasource "${t}" provided to PrismaClient constructor.
It should have this form: { url: "CONNECTION_STRING" }`);
            if (typeof o != "string") throw new _(`Invalid value ${JSON.stringify(o)} for datasource "${t}" provided to PrismaClient constructor.
It should have this form: { url: "CONNECTION_STRING" }`);
          }
        }
      }
    }, adapter: (e, r) => {
      if (!e && Er(r.generator) === "client") throw new _('Using engine type "client" requires a driver adapter to be provided to PrismaClient constructor.');
      if (e !== null) {
        if (e === void 0) throw new _('"adapter" property must not be undefined, use null to conditionally disable driver adapters.');
        if (Er(r.generator) === "binary") throw new _('Cannot use a driver adapter with the "binary" Query Engine. Please use the "library" Query Engine.');
      }
    }, datasourceUrl: (e) => {
      if (typeof e < "u" && typeof e != "string") throw new _(`Invalid value ${JSON.stringify(e)} for "datasourceUrl" provided to PrismaClient constructor.
Expected string or undefined.`);
    }, errorFormat: (e) => {
      if (e) {
        if (typeof e != "string") throw new _(`Invalid value ${JSON.stringify(e)} for "errorFormat" provided to PrismaClient constructor.`);
        if (!nu.includes(e)) {
          let r = Jr(e, nu);
          throw new _(`Invalid errorFormat ${e} provided to PrismaClient constructor.${r}`);
        }
      }
    }, log: (e) => {
      if (!e) return;
      if (!Array.isArray(e)) throw new _(`Invalid value ${JSON.stringify(e)} for "log" provided to PrismaClient constructor.`);
      function r(t) {
        if (typeof t == "string" && !iu.includes(t)) {
          let n = Jr(t, iu);
          throw new _(`Invalid log level "${t}" provided to PrismaClient constructor.${n}`);
        }
      }
      for (let t of e) {
        r(t);
        let n = { level: r, emit: (i) => {
          let o = ["stdout", "event"];
          if (!o.includes(i)) {
            let s = Jr(i, o);
            throw new _(`Invalid value ${JSON.stringify(i)} for "emit" in logLevel provided to PrismaClient constructor.${s}`);
          }
        } };
        if (t && typeof t == "object") for (let [i, o] of Object.entries(t)) if (n[i]) n[i](o);
        else throw new _(`Invalid property ${i} for "log" provided to PrismaClient constructor`);
      }
    }, transactionOptions: (e) => {
      if (!e) return;
      let r = e.maxWait;
      if (r != null && r <= 0) throw new _(`Invalid value ${r} for maxWait in "transactionOptions" provided to PrismaClient constructor. maxWait needs to be greater than 0`);
      let t = e.timeout;
      if (t != null && t <= 0) throw new _(`Invalid value ${t} for timeout in "transactionOptions" provided to PrismaClient constructor. timeout needs to be greater than 0`);
    }, omit: (e, r) => {
      if (typeof e != "object") throw new _('"omit" option is expected to be an object.');
      if (e === null) throw new _('"omit" option can not be `null`');
      let t = [];
      for (let [n, i] of Object.entries(e)) {
        let o = Nf(n, r.runtimeDataModel);
        if (!o) {
          t.push({ kind: "UnknownModel", modelKey: n });
          continue;
        }
        for (let [s, a] of Object.entries(i)) {
          let l = o.fields.find((u) => u.name === s);
          if (!l) {
            t.push({ kind: "UnknownField", modelKey: n, fieldName: s });
            continue;
          }
          if (l.relationName) {
            t.push({ kind: "RelationInOmit", modelKey: n, fieldName: s });
            continue;
          }
          typeof a != "boolean" && t.push({ kind: "InvalidFieldValue", modelKey: n, fieldName: s });
        }
      }
      if (t.length > 0) throw new _(Lf(e, t));
    }, __internal: (e) => {
      if (!e) return;
      let r = ["debug", "engine", "configOverride"];
      if (typeof e != "object") throw new _(`Invalid value ${JSON.stringify(e)} for "__internal" to PrismaClient constructor`);
      for (let [t] of Object.entries(e)) if (!r.includes(t)) {
        let n = Jr(t, r);
        throw new _(`Invalid property ${JSON.stringify(t)} for "__internal" provided to PrismaClient constructor.${n}`);
      }
    } };
    function au(e, r) {
      for (let [t, n] of Object.entries(e)) {
        if (!tu.includes(t)) {
          let i = Jr(t, tu);
          throw new _(`Unknown property ${t} provided to PrismaClient constructor.${i}`);
        }
        kf[t](n, r);
      }
      if (e.datasourceUrl && e.datasources) throw new _('Can not use "datasourceUrl" and "datasources" options at the same time. Pick one of them');
    }
    function Jr(e, r) {
      if (r.length === 0 || typeof e != "string") return "";
      let t = _f(e, r);
      return t ? ` Did you mean "${t}"?` : "";
    }
    function _f(e, r) {
      if (r.length === 0) return null;
      let t = r.map((i) => ({ value: i, distance: (0, su.default)(e, i) }));
      t.sort((i, o) => i.distance < o.distance ? -1 : 1);
      let n = t[0];
      return n.distance < 3 ? n.value : null;
    }
    function Nf(e, r) {
      return ou(r.models, e) ?? ou(r.types, e);
    }
    function ou(e, r) {
      let t = Object.keys(e).find((n) => We(n) === r);
      if (t) return e[t];
    }
    function Lf(e, r) {
      let t = _r(e);
      for (let o of r) switch (o.kind) {
        case "UnknownModel":
          t.arguments.getField(o.modelKey)?.markAsError(), t.addErrorMessage(() => `Unknown model name: ${o.modelKey}.`);
          break;
        case "UnknownField":
          t.arguments.getDeepField([o.modelKey, o.fieldName])?.markAsError(), t.addErrorMessage(() => `Model "${o.modelKey}" does not have a field named "${o.fieldName}".`);
          break;
        case "RelationInOmit":
          t.arguments.getDeepField([o.modelKey, o.fieldName])?.markAsError(), t.addErrorMessage(() => 'Relations are already excluded by default and can not be specified in "omit".');
          break;
        case "InvalidFieldValue":
          t.arguments.getDeepFieldValue([o.modelKey, o.fieldName])?.markAsError(), t.addErrorMessage(() => "Omit field option value must be a boolean.");
          break;
      }
      let { message: n, args: i } = _n(t, "colorless");
      return `Error validating "omit" option:

${i}

${n}`;
    }
    function lu(e) {
      return e.length === 0 ? Promise.resolve([]) : new Promise((r, t) => {
        let n = new Array(e.length), i = null, o = false, s = 0, a = () => {
          o || (s++, s === e.length && (o = true, i ? t(i) : r(n)));
        }, l = (u) => {
          o || (o = true, t(u));
        };
        for (let u = 0; u < e.length; u++) e[u].then((c) => {
          n[u] = c, a();
        }, (c) => {
          if (!zn(c)) {
            l(c);
            return;
          }
          c.batchRequestIdx === u ? l(c) : (i || (i = c), a());
        });
      });
    }
    var rr = N("prisma:client");
    typeof globalThis == "object" && (globalThis.NODE_CLIENT = true);
    var Ff = { requestArgsToMiddlewareArgs: (e) => e, middlewareArgsToRequestArgs: (e) => e };
    var Mf = Symbol.for("prisma.client.transaction.id");
    var $f = { id: 0, nextId() {
      return ++this.id;
    } };
    function fu(e) {
      class r {
        _originalClient = this;
        _runtimeDataModel;
        _requestHandler;
        _connectionPromise;
        _disconnectionPromise;
        _engineConfig;
        _accelerateEngineConfig;
        _clientVersion;
        _errorFormat;
        _tracingHelper;
        _previewFeatures;
        _activeProvider;
        _globalOmit;
        _extensions;
        _engine;
        _appliedParent;
        _createPrismaPromise = Ro();
        constructor(n) {
          e = n?.__internal?.configOverride?.(e) ?? e, sl(e), n && au(n, e);
          let i = new du.EventEmitter().on("error", () => {
          });
          this._extensions = Nr.empty(), this._previewFeatures = $l(e), this._clientVersion = e.clientVersion ?? ru, this._activeProvider = e.activeProvider, this._globalOmit = n?.omit, this._tracingHelper = Hl();
          let o = e.relativeEnvPaths && { rootEnvPath: e.relativeEnvPaths.rootEnvPath && ri.default.resolve(e.dirname, e.relativeEnvPaths.rootEnvPath), schemaEnvPath: e.relativeEnvPaths.schemaEnvPath && ri.default.resolve(e.dirname, e.relativeEnvPaths.schemaEnvPath) }, s;
          if (n?.adapter) {
            s = n.adapter;
            let l = e.activeProvider === "postgresql" || e.activeProvider === "cockroachdb" ? "postgres" : e.activeProvider;
            if (s.provider !== l) throw new P(`The Driver Adapter \`${s.adapterName}\`, based on \`${s.provider}\`, is not compatible with the provider \`${l}\` specified in the Prisma schema.`, this._clientVersion);
            if (n.datasources || n.datasourceUrl !== void 0) throw new P("Custom datasource configuration is not compatible with Prisma Driver Adapters. Please define the database connection string directly in the Driver Adapter configuration.", this._clientVersion);
          }
          let a = !s && o && st(o, { conflictCheck: "none" }) || e.injectableEdgeEnv?.();
          try {
            let l = n ?? {}, u = l.__internal ?? {}, c = u.debug === true;
            c && N.enable("prisma:client");
            let p = ri.default.resolve(e.dirname, e.relativePath);
            mu.default.existsSync(p) || (p = e.dirname), rr("dirname", e.dirname), rr("relativePath", e.relativePath), rr("cwd", p);
            let d = u.engine || {};
            if (l.errorFormat ? this._errorFormat = l.errorFormat : process.env.NODE_ENV === "production" ? this._errorFormat = "minimal" : process.env.NO_COLOR ? this._errorFormat = "colorless" : this._errorFormat = "colorless", this._runtimeDataModel = e.runtimeDataModel, this._engineConfig = { cwd: p, dirname: e.dirname, enableDebugLogs: c, allowTriggerPanic: d.allowTriggerPanic, prismaPath: d.binaryPath ?? void 0, engineEndpoint: d.endpoint, generator: e.generator, showColors: this._errorFormat === "pretty", logLevel: l.log && zl(l.log), logQueries: l.log && !!(typeof l.log == "string" ? l.log === "query" : l.log.find((f) => typeof f == "string" ? f === "query" : f.level === "query")), env: a?.parsed ?? {}, flags: [], engineWasm: e.engineWasm, compilerWasm: e.compilerWasm, clientVersion: e.clientVersion, engineVersion: e.engineVersion, previewFeatures: this._previewFeatures, activeProvider: e.activeProvider, inlineSchema: e.inlineSchema, overrideDatasources: al(l, e.datasourceNames), inlineDatasources: e.inlineDatasources, inlineSchemaHash: e.inlineSchemaHash, tracingHelper: this._tracingHelper, transactionOptions: { maxWait: l.transactionOptions?.maxWait ?? 2e3, timeout: l.transactionOptions?.timeout ?? 5e3, isolationLevel: l.transactionOptions?.isolationLevel }, logEmitter: i, isBundled: e.isBundled, adapter: s }, this._accelerateEngineConfig = { ...this._engineConfig, accelerateUtils: { resolveDatasourceUrl: jr, getBatchRequestPayload: Mr, prismaGraphQLToJSError: $r, PrismaClientUnknownRequestError: V, PrismaClientInitializationError: P, PrismaClientKnownRequestError: z2, debug: N("prisma:client:accelerateEngine"), engineVersion: cu.version, clientVersion: e.clientVersion } }, rr("clientVersion", e.clientVersion), this._engine = Ml(e, this._engineConfig), this._requestHandler = new ei(this, i), l.log) for (let f of l.log) {
              let h = typeof f == "string" ? f : f.emit === "stdout" ? f.level : null;
              h && this.$on(h, (g) => {
                nt.log(`${nt.tags[h] ?? ""}`, g.message || g.query);
              });
            }
          } catch (l) {
            throw l.clientVersion = this._clientVersion, l;
          }
          return this._appliedParent = Pt(this);
        }
        get [Symbol.toStringTag]() {
          return "PrismaClient";
        }
        $on(n, i) {
          return n === "beforeExit" ? this._engine.onBeforeExit(i) : n && this._engineConfig.logEmitter.on(n, i), this;
        }
        $connect() {
          try {
            return this._engine.start();
          } catch (n) {
            throw n.clientVersion = this._clientVersion, n;
          }
        }
        async $disconnect() {
          try {
            await this._engine.stop();
          } catch (n) {
            throw n.clientVersion = this._clientVersion, n;
          } finally {
            Uo();
          }
        }
        $executeRawInternal(n, i, o, s) {
          let a = this._activeProvider;
          return this._request({ action: "executeRaw", args: o, transaction: n, clientMethod: i, argsMapper: So({ clientMethod: i, activeProvider: a }), callsite: Ze(this._errorFormat), dataPath: [], middlewareArgsMapper: s });
        }
        $executeRaw(n, ...i) {
          return this._createPrismaPromise((o) => {
            if (n.raw !== void 0 || n.sql !== void 0) {
              let [s, a] = uu(n, i);
              return To(this._activeProvider, s.text, s.values, Array.isArray(n) ? "prisma.$executeRaw`<SQL>`" : "prisma.$executeRaw(sql`<SQL>`)"), this.$executeRawInternal(o, "$executeRaw", s, a);
            }
            throw new Z("`$executeRaw` is a tag function, please use it like the following:\n```\nconst result = await prisma.$executeRaw`UPDATE User SET cool = ${true} WHERE email = ${'user@email.com'};`\n```\n\nOr read our docs at https://www.prisma.io/docs/concepts/components/prisma-client/raw-database-access#executeraw\n", { clientVersion: this._clientVersion });
          });
        }
        $executeRawUnsafe(n, ...i) {
          return this._createPrismaPromise((o) => (To(this._activeProvider, n, i, "prisma.$executeRawUnsafe(<SQL>, [...values])"), this.$executeRawInternal(o, "$executeRawUnsafe", [n, ...i])));
        }
        $runCommandRaw(n) {
          if (e.activeProvider !== "mongodb") throw new Z(`The ${e.activeProvider} provider does not support $runCommandRaw. Use the mongodb provider.`, { clientVersion: this._clientVersion });
          return this._createPrismaPromise((i) => this._request({ args: n, clientMethod: "$runCommandRaw", dataPath: [], action: "runCommandRaw", argsMapper: ql, callsite: Ze(this._errorFormat), transaction: i }));
        }
        async $queryRawInternal(n, i, o, s) {
          let a = this._activeProvider;
          return this._request({ action: "queryRaw", args: o, transaction: n, clientMethod: i, argsMapper: So({ clientMethod: i, activeProvider: a }), callsite: Ze(this._errorFormat), dataPath: [], middlewareArgsMapper: s });
        }
        $queryRaw(n, ...i) {
          return this._createPrismaPromise((o) => {
            if (n.raw !== void 0 || n.sql !== void 0) return this.$queryRawInternal(o, "$queryRaw", ...uu(n, i));
            throw new Z("`$queryRaw` is a tag function, please use it like the following:\n```\nconst result = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${1} OR email = ${'user@email.com'};`\n```\n\nOr read our docs at https://www.prisma.io/docs/concepts/components/prisma-client/raw-database-access#queryraw\n", { clientVersion: this._clientVersion });
          });
        }
        $queryRawTyped(n) {
          return this._createPrismaPromise((i) => {
            if (!this._hasPreviewFlag("typedSql")) throw new Z("`typedSql` preview feature must be enabled in order to access $queryRawTyped API", { clientVersion: this._clientVersion });
            return this.$queryRawInternal(i, "$queryRawTyped", n);
          });
        }
        $queryRawUnsafe(n, ...i) {
          return this._createPrismaPromise((o) => this.$queryRawInternal(o, "$queryRawUnsafe", [n, ...i]));
        }
        _transactionWithArray({ promises: n, options: i }) {
          let o = $f.nextId(), s = Yl(n.length), a = n.map((l, u) => {
            if (l?.[Symbol.toStringTag] !== "PrismaPromise") throw new Error("All elements of the array need to be Prisma Client promises. Hint: Please make sure you are not awaiting the Prisma client calls you intended to pass in the $transaction function.");
            let c = i?.isolationLevel ?? this._engineConfig.transactionOptions.isolationLevel, p = { kind: "batch", id: o, index: u, isolationLevel: c, lock: s };
            return l.requestTransaction?.(p) ?? l;
          });
          return lu(a);
        }
        async _transactionWithCallback({ callback: n, options: i }) {
          let o = { traceparent: this._tracingHelper.getTraceParent() }, s = { maxWait: i?.maxWait ?? this._engineConfig.transactionOptions.maxWait, timeout: i?.timeout ?? this._engineConfig.transactionOptions.timeout, isolationLevel: i?.isolationLevel ?? this._engineConfig.transactionOptions.isolationLevel }, a = await this._engine.transaction("start", o, s), l;
          try {
            let u = { kind: "itx", ...a };
            l = await n(this._createItxClient(u)), await this._engine.transaction("commit", o, a);
          } catch (u) {
            throw await this._engine.transaction("rollback", o, a).catch(() => {
            }), u;
          }
          return l;
        }
        _createItxClient(n) {
          return he(Pt(he(Qa(this), [re("_appliedParent", () => this._appliedParent._createItxClient(n)), re("_createPrismaPromise", () => Ro(n)), re(Mf, () => n.id)])), [Fr(Ya)]);
        }
        $transaction(n, i) {
          let o;
          typeof n == "function" ? this._engineConfig.adapter?.adapterName === "@prisma/adapter-d1" ? o = () => {
            throw new Error("Cloudflare D1 does not support interactive transactions. We recommend you to refactor your queries with that limitation in mind, and use batch transactions with `prisma.$transactions([])` where applicable.");
          } : o = () => this._transactionWithCallback({ callback: n, options: i }) : o = () => this._transactionWithArray({ promises: n, options: i });
          let s = { name: "transaction", attributes: { method: "$transaction" } };
          return this._tracingHelper.runInChildSpan(s, o);
        }
        _request(n) {
          n.otelParentCtx = this._tracingHelper.getActiveContext();
          let i = n.middlewareArgsMapper ?? Ff, o = { args: i.requestArgsToMiddlewareArgs(n.args), dataPath: n.dataPath, runInTransaction: !!n.transaction, action: n.action, model: n.model }, s = { operation: { name: "operation", attributes: { method: o.action, model: o.model, name: o.model ? `${o.model}.${o.action}` : o.action } } }, a = async (l) => {
            let { runInTransaction: u, args: c, ...p } = l, d = { ...n, ...p };
            c && (d.args = i.middlewareArgsToRequestArgs(c)), n.transaction !== void 0 && u === false && delete d.transaction;
            let f = await el(this, d);
            return d.model ? Ha({ result: f, modelName: d.model, args: d.args, extensions: this._extensions, runtimeDataModel: this._runtimeDataModel, globalOmit: this._globalOmit }) : f;
          };
          return this._tracingHelper.runInChildSpan(s.operation, () => new pu.AsyncResource("prisma-client-request").runInAsyncScope(() => a(o)));
        }
        async _executeRequest({ args: n, clientMethod: i, dataPath: o, callsite: s, action: a, model: l, argsMapper: u, transaction: c, unpacker: p, otelParentCtx: d, customDataProxyFetch: f }) {
          try {
            n = u ? u(n) : n;
            let h = { name: "serialize" }, g = this._tracingHelper.runInChildSpan(h, () => $n({ modelName: l, runtimeDataModel: this._runtimeDataModel, action: a, args: n, clientMethod: i, callsite: s, extensions: this._extensions, errorFormat: this._errorFormat, clientVersion: this._clientVersion, previewFeatures: this._previewFeatures, globalOmit: this._globalOmit }));
            return N.enabled("prisma:client") && (rr("Prisma Client call:"), rr(`prisma.${i}(${Na(n)})`), rr("Generated request:"), rr(JSON.stringify(g, null, 2) + `
`)), c?.kind === "batch" && await c.lock, this._requestHandler.request({ protocolQuery: g, modelName: l, action: a, clientMethod: i, dataPath: o, callsite: s, args: n, extensions: this._extensions, transaction: c, unpacker: p, otelParentCtx: d, otelChildCtx: this._tracingHelper.getActiveContext(), globalOmit: this._globalOmit, customDataProxyFetch: f });
          } catch (h) {
            throw h.clientVersion = this._clientVersion, h;
          }
        }
        $metrics = new Lr(this);
        _hasPreviewFlag(n) {
          return !!this._engineConfig.previewFeatures?.includes(n);
        }
        $applyPendingMigrations() {
          return this._engine.applyPendingMigrations();
        }
        $extends = Wa;
      }
      return r;
    }
    function uu(e, r) {
      return qf(e) ? [new ie(e, r), Wl] : [e, Jl];
    }
    function qf(e) {
      return Array.isArray(e) && Array.isArray(e.raw);
    }
    var Vf = /* @__PURE__ */ new Set(["toJSON", "$$typeof", "asymmetricMatch", Symbol.iterator, Symbol.toStringTag, Symbol.isConcatSpreadable, Symbol.toPrimitive]);
    function gu(e) {
      return new Proxy(e, { get(r, t) {
        if (t in r) return r[t];
        if (!Vf.has(t)) throw new TypeError(`Invalid enum value: ${String(t)}`);
      } });
    }
    function hu(e) {
      st(e, { conflictCheck: "warn" });
    }
  }
});

// src/generated/store-client/index.js
var require_store_client = __commonJS({
  "src/generated/store-client/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var {
      PrismaClientKnownRequestError: PrismaClientKnownRequestError2,
      PrismaClientUnknownRequestError: PrismaClientUnknownRequestError2,
      PrismaClientRustPanicError: PrismaClientRustPanicError2,
      PrismaClientInitializationError: PrismaClientInitializationError2,
      PrismaClientValidationError: PrismaClientValidationError2,
      getPrismaClient: getPrismaClient2,
      sqltag: sqltag2,
      empty: empty2,
      join: join2,
      raw: raw2,
      skip: skip2,
      Decimal: Decimal2,
      Debug: Debug2,
      objectEnumValues: objectEnumValues2,
      makeStrictEnum: makeStrictEnum2,
      Extensions: Extensions2,
      warnOnce: warnOnce2,
      defineDmmfProperty: defineDmmfProperty2,
      Public: Public2,
      getRuntime: getRuntime2,
      createParam: createParam2
    } = require_library();
    var Prisma = {};
    exports2.Prisma = Prisma;
    exports2.$Enums = {};
    Prisma.prismaVersion = {
      client: "6.19.2",
      engine: "c2990dca591cba766e3b7ef5d9e8a84796e47ab7"
    };
    Prisma.PrismaClientKnownRequestError = PrismaClientKnownRequestError2;
    Prisma.PrismaClientUnknownRequestError = PrismaClientUnknownRequestError2;
    Prisma.PrismaClientRustPanicError = PrismaClientRustPanicError2;
    Prisma.PrismaClientInitializationError = PrismaClientInitializationError2;
    Prisma.PrismaClientValidationError = PrismaClientValidationError2;
    Prisma.Decimal = Decimal2;
    Prisma.sql = sqltag2;
    Prisma.empty = empty2;
    Prisma.join = join2;
    Prisma.raw = raw2;
    Prisma.validator = Public2.validator;
    Prisma.getExtensionContext = Extensions2.getExtensionContext;
    Prisma.defineExtension = Extensions2.defineExtension;
    Prisma.DbNull = objectEnumValues2.instances.DbNull;
    Prisma.JsonNull = objectEnumValues2.instances.JsonNull;
    Prisma.AnyNull = objectEnumValues2.instances.AnyNull;
    Prisma.NullTypes = {
      DbNull: objectEnumValues2.classes.DbNull,
      JsonNull: objectEnumValues2.classes.JsonNull,
      AnyNull: objectEnumValues2.classes.AnyNull
    };
    var path = require("path");
    exports2.Prisma.TransactionIsolationLevel = makeStrictEnum2({
      ReadUncommitted: "ReadUncommitted",
      ReadCommitted: "ReadCommitted",
      RepeatableRead: "RepeatableRead",
      Serializable: "Serializable"
    });
    exports2.Prisma.BranchScalarFieldEnum = {
      id: "id",
      name: "name",
      code: "code",
      isMainBranch: "isMainBranch",
      address: "address",
      phone: "phone",
      status: "status",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.UserScalarFieldEnum = {
      id: "id",
      email: "email",
      name: "name",
      password: "password",
      role: "role",
      phone: "phone",
      avatar: "avatar",
      code: "code",
      salary: "salary",
      hireDate: "hireDate",
      shifts: "shifts",
      totalSales: "totalSales",
      employeeStatus: "employeeStatus",
      notes: "notes",
      isLocked: "isLocked",
      twoFactorEnabled: "twoFactorEnabled",
      branchId: "branchId",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.ApiKeyScalarFieldEnum = {
      id: "id",
      name: "name",
      keyId: "keyId",
      secretHash: "secretHash",
      lastFour: "lastFour",
      scopes: "scopes",
      isActive: "isActive",
      lastUsedAt: "lastUsedAt",
      expiresAt: "expiresAt",
      userId: "userId",
      createdAt: "createdAt"
    };
    exports2.Prisma.SalesCheckinScalarFieldEnum = {
      id: "id",
      userId: "userId",
      type: "type",
      latitude: "latitude",
      longitude: "longitude",
      address: "address",
      note: "note",
      photo: "photo",
      customerId: "customerId",
      customerName: "customerName",
      createdAt: "createdAt"
    };
    exports2.Prisma.CategoryScalarFieldEnum = {
      id: "id",
      name: "name",
      description: "description",
      color: "color",
      level: "level",
      parentId: "parentId",
      createdAt: "createdAt"
    };
    exports2.Prisma.BrandScalarFieldEnum = {
      id: "id",
      name: "name",
      description: "description",
      logo: "logo",
      createdAt: "createdAt"
    };
    exports2.Prisma.ProductScalarFieldEnum = {
      id: "id",
      name: "name",
      sku: "sku",
      barcode: "barcode",
      description: "description",
      categoryId: "categoryId",
      brandId: "brandId",
      productType: "productType",
      costPrice: "costPrice",
      sellingPrice: "sellingPrice",
      taxInclusive: "taxInclusive",
      stock: "stock",
      minStock: "minStock",
      maxStock: "maxStock",
      baseUnit: "baseUnit",
      trackSerial: "trackSerial",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.ProductSerialScalarFieldEnum = {
      id: "id",
      productId: "productId",
      serial: "serial",
      status: "status",
      soldAt: "soldAt",
      note: "note",
      createdAt: "createdAt"
    };
    exports2.Prisma.UnitConversionScalarFieldEnum = {
      id: "id",
      productId: "productId",
      fromUnit: "fromUnit",
      toUnit: "toUnit",
      conversionRate: "conversionRate"
    };
    exports2.Prisma.ProductImageScalarFieldEnum = {
      id: "id",
      productId: "productId",
      url: "url",
      isPrimary: "isPrimary"
    };
    exports2.Prisma.CustomerGroupScalarFieldEnum = {
      id: "id",
      name: "name",
      discount: "discount",
      color: "color"
    };
    exports2.Prisma.CustomerScalarFieldEnum = {
      id: "id",
      code: "code",
      name: "name",
      phone: "phone",
      email: "email",
      address: "address",
      groupId: "groupId",
      birthday: "birthday",
      gender: "gender",
      notes: "notes",
      totalPurchases: "totalPurchases",
      totalOrders: "totalOrders",
      debt: "debt",
      loyaltyPoints: "loyaltyPoints",
      tier: "tier",
      lastPurchaseDate: "lastPurchaseDate",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.TransactionScalarFieldEnum = {
      id: "id",
      receiptNumber: "receiptNumber",
      customerId: "customerId",
      customerName: "customerName",
      customerPhone: "customerPhone",
      branchId: "branchId",
      subtotal: "subtotal",
      discount: "discount",
      tax: "tax",
      total: "total",
      amountReceived: "amountReceived",
      change: "change",
      status: "status",
      createdBy: "createdBy",
      createdByName: "createdByName",
      notes: "notes",
      returnedAt: "returnedAt",
      returnReason: "returnReason",
      transactionDate: "transactionDate",
      vatInvoiceNumber: "vatInvoiceNumber",
      vatIssuedAt: "vatIssuedAt",
      vatStatus: "vatStatus",
      createdAt: "createdAt"
    };
    exports2.Prisma.TransactionItemScalarFieldEnum = {
      id: "id",
      transactionId: "transactionId",
      productId: "productId",
      productName: "productName",
      sku: "sku",
      quantity: "quantity",
      unitPrice: "unitPrice",
      discount: "discount",
      lineTotal: "lineTotal"
    };
    exports2.Prisma.PaymentScalarFieldEnum = {
      id: "id",
      transactionId: "transactionId",
      type: "type",
      amount: "amount",
      reference: "reference"
    };
    exports2.Prisma.InventoryTransactionScalarFieldEnum = {
      id: "id",
      type: "type",
      productId: "productId",
      productName: "productName",
      productSku: "productSku",
      quantity: "quantity",
      reason: "reason",
      note: "note",
      referenceId: "referenceId",
      referenceType: "referenceType",
      unitPrice: "unitPrice",
      costPriceAfter: "costPriceAfter",
      supplierId: "supplierId",
      supplierName: "supplierName",
      branchId: "branchId",
      userId: "userId",
      userName: "userName",
      transactionDate: "transactionDate",
      createdAt: "createdAt"
    };
    exports2.Prisma.ImportReceiptScalarFieldEnum = {
      id: "id",
      code: "code",
      supplierId: "supplierId",
      supplierName: "supplierName",
      totalCost: "totalCost",
      totalItems: "totalItems",
      status: "status",
      note: "note",
      branchId: "branchId",
      userId: "userId",
      userName: "userName",
      transactionDate: "transactionDate",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.ImportReceiptItemScalarFieldEnum = {
      id: "id",
      receiptId: "receiptId",
      productId: "productId",
      productName: "productName",
      productSku: "productSku",
      quantity: "quantity",
      costPrice: "costPrice",
      total: "total"
    };
    exports2.Prisma.PromotionScalarFieldEnum = {
      id: "id",
      code: "code",
      name: "name",
      description: "description",
      type: "type",
      value: "value",
      minOrderValue: "minOrderValue",
      maxDiscount: "maxDiscount",
      startDate: "startDate",
      endDate: "endDate",
      status: "status",
      usageCount: "usageCount",
      usageLimit: "usageLimit",
      applicableTo: "applicableTo",
      categoryIds: "categoryIds",
      productIds: "productIds",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.SupplierScalarFieldEnum = {
      id: "id",
      code: "code",
      name: "name",
      contactName: "contactName",
      phone: "phone",
      email: "email",
      address: "address",
      taxCode: "taxCode",
      totalOrders: "totalOrders",
      totalValue: "totalValue",
      status: "status",
      notes: "notes",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.PurchaseOrderScalarFieldEnum = {
      id: "id",
      code: "code",
      supplierId: "supplierId",
      supplierName: "supplierName",
      status: "status",
      totalAmount: "totalAmount",
      notes: "notes",
      expectedDate: "expectedDate",
      receivedDate: "receivedDate",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.PurchaseOrderItemScalarFieldEnum = {
      id: "id",
      purchaseOrderId: "purchaseOrderId",
      productName: "productName",
      sku: "sku",
      quantity: "quantity",
      unitPrice: "unitPrice"
    };
    exports2.Prisma.ExpenseScalarFieldEnum = {
      id: "id",
      description: "description",
      amount: "amount",
      category: "category",
      date: "date",
      paidBy: "paidBy",
      recurring: "recurring",
      branchId: "branchId",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.NotificationScalarFieldEnum = {
      id: "id",
      title: "title",
      message: "message",
      type: "type",
      read: "read",
      userId: "userId",
      createdAt: "createdAt"
    };
    exports2.Prisma.WarrantyScalarFieldEnum = {
      id: "id",
      code: "code",
      productId: "productId",
      productName: "productName",
      customerName: "customerName",
      customerPhone: "customerPhone",
      serialNumber: "serialNumber",
      startDate: "startDate",
      endDate: "endDate",
      status: "status",
      notes: "notes",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.RepairScalarFieldEnum = {
      id: "id",
      code: "code",
      productName: "productName",
      customerName: "customerName",
      customerPhone: "customerPhone",
      issue: "issue",
      status: "status",
      cost: "cost",
      estimatedDate: "estimatedDate",
      completedDate: "completedDate",
      notes: "notes",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.QuotationScalarFieldEnum = {
      id: "id",
      code: "code",
      customerName: "customerName",
      customerPhone: "customerPhone",
      items: "items",
      totalAmount: "totalAmount",
      status: "status",
      validUntil: "validUntil",
      notes: "notes",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.AuditLogScalarFieldEnum = {
      id: "id",
      userId: "userId",
      userName: "userName",
      action: "action",
      entity: "entity",
      entityId: "entityId",
      details: "details",
      ipAddress: "ipAddress",
      createdAt: "createdAt"
    };
    exports2.Prisma.PriceHistoryScalarFieldEnum = {
      id: "id",
      productId: "productId",
      productName: "productName",
      productSku: "productSku",
      oldPrice: "oldPrice",
      newPrice: "newPrice",
      changedBy: "changedBy",
      reason: "reason",
      createdAt: "createdAt"
    };
    exports2.Prisma.ShippingOrderScalarFieldEnum = {
      id: "id",
      code: "code",
      transactionId: "transactionId",
      customerName: "customerName",
      customerPhone: "customerPhone",
      address: "address",
      driverId: "driverId",
      driverName: "driverName",
      status: "status",
      shippingFee: "shippingFee",
      cod: "cod",
      notes: "notes",
      estimatedDate: "estimatedDate",
      deliveredDate: "deliveredDate",
      branchId: "branchId",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.DriverScalarFieldEnum = {
      id: "id",
      code: "code",
      name: "name",
      phone: "phone",
      vehicleType: "vehicleType",
      vehiclePlate: "vehiclePlate",
      status: "status",
      totalDeliveries: "totalDeliveries",
      rating: "rating",
      notes: "notes",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.TaxConfigScalarFieldEnum = {
      id: "id",
      name: "name",
      rate: "rate",
      description: "description",
      isDefault: "isDefault",
      status: "status"
    };
    exports2.Prisma.TaxDeclarationScalarFieldEnum = {
      id: "id",
      formType: "formType",
      period: "period",
      periodType: "periodType",
      year: "year",
      month: "month",
      quarter: "quarter",
      taxCode: "taxCode",
      companyName: "companyName",
      companyAddress: "companyAddress",
      businessType: "businessType",
      ct21: "ct21",
      ct22: "ct22",
      ct23: "ct23",
      ct24: "ct24",
      ct25: "ct25",
      ct26: "ct26",
      ct27: "ct27",
      ct28: "ct28",
      ct29: "ct29",
      ct30: "ct30",
      ct31: "ct31",
      ct32: "ct32",
      ct33: "ct33",
      ct34: "ct34",
      ct35: "ct35",
      ct36: "ct36",
      ct37: "ct37",
      ct38: "ct38",
      ct39: "ct39",
      ct40a: "ct40a",
      ct40b: "ct40b",
      cnkdRevenue: "cnkdRevenue",
      cnkdVatRate: "cnkdVatRate",
      cnkdVatAmount: "cnkdVatAmount",
      cnkdPitRate: "cnkdPitRate",
      cnkdPitAmount: "cnkdPitAmount",
      cnkdTotalTax: "cnkdTotalTax",
      cnkdThreshold: "cnkdThreshold",
      status: "status",
      filedAt: "filedAt",
      notes: "notes",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.CustomerSegmentScalarFieldEnum = {
      id: "id",
      name: "name",
      description: "description",
      conditions: "conditions",
      customerCount: "customerCount",
      color: "color",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.CurrencyScalarFieldEnum = {
      id: "id",
      code: "code",
      name: "name",
      symbol: "symbol",
      rate: "rate",
      isBase: "isBase",
      status: "status",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.FeedbackScalarFieldEnum = {
      id: "id",
      customerName: "customerName",
      customerPhone: "customerPhone",
      type: "type",
      rating: "rating",
      message: "message",
      status: "status",
      response: "response",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.ScheduleScalarFieldEnum = {
      id: "id",
      userId: "userId",
      userName: "userName",
      date: "date",
      shift: "shift",
      status: "status",
      notes: "notes",
      branchId: "branchId",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.ReturnOrderScalarFieldEnum = {
      id: "id",
      code: "code",
      originalInvoice: "originalInvoice",
      transactionId: "transactionId",
      customerName: "customerName",
      customerPhone: "customerPhone",
      status: "status",
      reason: "reason",
      refundMethod: "refundMethod",
      refundAmount: "refundAmount",
      totalRefund: "totalRefund",
      notes: "notes",
      staffName: "staffName",
      branchId: "branchId",
      processedAt: "processedAt",
      refundedAt: "refundedAt",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.ReturnItemScalarFieldEnum = {
      id: "id",
      returnOrderId: "returnOrderId",
      productId: "productId",
      productName: "productName",
      sku: "sku",
      quantity: "quantity",
      unitPrice: "unitPrice",
      returnReason: "returnReason",
      condition: "condition",
      restocked: "restocked"
    };
    exports2.Prisma.DebtEntryScalarFieldEnum = {
      id: "id",
      customerId: "customerId",
      customerName: "customerName",
      phone: "phone",
      type: "type",
      amount: "amount",
      description: "description",
      balance: "balance",
      createdAt: "createdAt"
    };
    exports2.Prisma.BundleScalarFieldEnum = {
      id: "id",
      name: "name",
      category: "category",
      items: "items",
      originalTotal: "originalTotal",
      bundlePrice: "bundlePrice",
      discount: "discount",
      active: "active",
      soldCount: "soldCount",
      validUntil: "validUntil",
      maxUsage: "maxUsage",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.SalesOrderScalarFieldEnum = {
      id: "id",
      orderNumber: "orderNumber",
      status: "status",
      salesUserId: "salesUserId",
      customerId: "customerId",
      customerName: "customerName",
      note: "note",
      subtotal: "subtotal",
      discount: "discount",
      total: "total",
      branchId: "branchId",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.SalesOrderItemScalarFieldEnum = {
      id: "id",
      salesOrderId: "salesOrderId",
      productId: "productId",
      productName: "productName",
      sku: "sku",
      quantity: "quantity",
      unitPrice: "unitPrice",
      lineTotal: "lineTotal"
    };
    exports2.Prisma.PriceListScalarFieldEnum = {
      id: "id",
      name: "name",
      description: "description",
      currency: "currency",
      isDefault: "isDefault",
      active: "active",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.PriceRuleScalarFieldEnum = {
      id: "id",
      priceListId: "priceListId",
      name: "name",
      type: "type",
      value: "value",
      scope: "scope",
      scopeIds: "scopeIds",
      appliesTo: "appliesTo",
      priority: "priority",
      startDate: "startDate",
      endDate: "endDate",
      active: "active",
      customerGroup: "customerGroup",
      minQty: "minQty",
      note: "note",
      createdAt: "createdAt"
    };
    exports2.Prisma.AnnouncementScalarFieldEnum = {
      id: "id",
      branchId: "branchId",
      title: "title",
      content: "content",
      priority: "priority",
      author: "author",
      pinned: "pinned",
      archived: "archived",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.AttendanceScalarFieldEnum = {
      id: "id",
      branchId: "branchId",
      userId: "userId",
      userName: "userName",
      role: "role",
      date: "date",
      checkIn: "checkIn",
      checkOut: "checkOut",
      status: "status",
      note: "note",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.LoyaltyMemberScalarFieldEnum = {
      id: "id",
      customerId: "customerId",
      name: "name",
      phone: "phone",
      tier: "tier",
      totalPoints: "totalPoints",
      lifetimePoints: "lifetimePoints",
      totalSpent: "totalSpent",
      joinDate: "joinDate",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.LoyaltyTransactionScalarFieldEnum = {
      id: "id",
      memberId: "memberId",
      action: "action",
      amount: "amount",
      description: "description",
      createdAt: "createdAt"
    };
    exports2.Prisma.ReviewScalarFieldEnum = {
      id: "id",
      productId: "productId",
      productName: "productName",
      category: "category",
      customerName: "customerName",
      rating: "rating",
      comment: "comment",
      sentiment: "sentiment",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.StoreSettingsScalarFieldEnum = {
      id: "id",
      name: "name",
      address: "address",
      phone: "phone",
      logo: "logo",
      description: "description",
      costPriceMethod: "costPriceMethod",
      trackSerial: "trackSerial",
      trackBatch: "trackBatch",
      allowNegativeStock: "allowNegativeStock",
      shiftConfig: "shiftConfig",
      businessType: "businessType",
      taxCode: "taxCode",
      ownerName: "ownerName",
      ownerIdNumber: "ownerIdNumber",
      representativeName: "representativeName",
      email: "email",
      website: "website",
      notifyLowStock: "notifyLowStock",
      notifyNewOrder: "notifyNewOrder",
      notifyDailyReport: "notifyDailyReport",
      notifyWeeklyReport: "notifyWeeklyReport",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.StoreScalarFieldEnum = {
      id: "id",
      name: "name",
      address: "address",
      phone: "phone",
      email: "email",
      website: "website",
      businessType: "businessType",
      taxCode: "taxCode",
      ownerName: "ownerName",
      ownerIdNumber: "ownerIdNumber",
      representativeName: "representativeName",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.BranchRequestScalarFieldEnum = {
      id: "id",
      storeName: "storeName",
      branchName: "branchName",
      branchCode: "branchCode",
      address: "address",
      phone: "phone",
      status: "status",
      requestedBy: "requestedBy",
      requestedByName: "requestedByName",
      reviewedBy: "reviewedBy",
      reviewedByName: "reviewedByName",
      reviewNote: "reviewNote",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.BranchDeleteRequestScalarFieldEnum = {
      id: "id",
      branchId: "branchId",
      branchName: "branchName",
      branchCode: "branchCode",
      storeName: "storeName",
      reason: "reason",
      status: "status",
      requestedBy: "requestedBy",
      requestedByName: "requestedByName",
      reviewedBy: "reviewedBy",
      reviewedByName: "reviewedByName",
      reviewNote: "reviewNote",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.PayrollRecordScalarFieldEnum = {
      id: "id",
      month: "month",
      year: "year",
      employeeId: "employeeId",
      employeeName: "employeeName",
      employeeCode: "employeeCode",
      department: "department",
      grossSalary: "grossSalary",
      workdays: "workdays",
      actualDays: "actualDays",
      bonus: "bonus",
      actualGross: "actualGross",
      bhxh_emp: "bhxh_emp",
      bhyt_emp: "bhyt_emp",
      bhtn_emp: "bhtn_emp",
      bhxh_er: "bhxh_er",
      bhyt_er: "bhyt_er",
      bhtn_er: "bhtn_er",
      pit: "pit",
      netSalary: "netSalary",
      totalCost: "totalCost",
      dependents: "dependents",
      status: "status",
      paidAt: "paidAt",
      notes: "notes",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.OnlineChannelScalarFieldEnum = {
      id: "id",
      name: "name",
      platform: "platform",
      status: "status",
      shopUrl: "shopUrl",
      apiKey: "apiKey",
      apiSecret: "apiSecret",
      accessToken: "accessToken",
      refreshToken: "refreshToken",
      tokenExpiresAt: "tokenExpiresAt",
      shopId: "shopId",
      webhookSecret: "webhookSecret",
      syncEnabled: "syncEnabled",
      lastSyncAt: "lastSyncAt",
      totalOrders: "totalOrders",
      totalRevenue: "totalRevenue",
      createdAt: "createdAt",
      updatedAt: "updatedAt",
      commissionRate: "commissionRate"
    };
    exports2.Prisma.OnlineOrderScalarFieldEnum = {
      id: "id",
      orderNumber: "orderNumber",
      channelId: "channelId",
      channelName: "channelName",
      platform: "platform",
      customerName: "customerName",
      customerPhone: "customerPhone",
      customerEmail: "customerEmail",
      shippingAddress: "shippingAddress",
      status: "status",
      subtotal: "subtotal",
      discount: "discount",
      shippingFee: "shippingFee",
      total: "total",
      paymentMethod: "paymentMethod",
      paymentStatus: "paymentStatus",
      paidAt: "paidAt",
      trackingNumber: "trackingNumber",
      shippingCarrier: "shippingCarrier",
      shippedAt: "shippedAt",
      deliveredAt: "deliveredAt",
      note: "note",
      internalNote: "internalNote",
      externalOrderId: "externalOrderId",
      externalStatus: "externalStatus",
      platformFee: "platformFee",
      platformFeeRate: "platformFeeRate",
      netRevenue: "netRevenue",
      syncedAt: "syncedAt",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports2.Prisma.OnlineOrderItemScalarFieldEnum = {
      id: "id",
      onlineOrderId: "onlineOrderId",
      productId: "productId",
      productName: "productName",
      sku: "sku",
      quantity: "quantity",
      unitPrice: "unitPrice",
      discount: "discount",
      lineTotal: "lineTotal"
    };
    exports2.Prisma.SyncLogScalarFieldEnum = {
      id: "id",
      channelId: "channelId",
      action: "action",
      status: "status",
      details: "details",
      ordersCount: "ordersCount",
      createdAt: "createdAt"
    };
    exports2.Prisma.SortOrder = {
      asc: "asc",
      desc: "desc"
    };
    exports2.Prisma.QueryMode = {
      default: "default",
      insensitive: "insensitive"
    };
    exports2.Prisma.NullsOrder = {
      first: "first",
      last: "last"
    };
    exports2.Prisma.ModelName = {
      Branch: "Branch",
      User: "User",
      ApiKey: "ApiKey",
      SalesCheckin: "SalesCheckin",
      Category: "Category",
      Brand: "Brand",
      Product: "Product",
      ProductSerial: "ProductSerial",
      UnitConversion: "UnitConversion",
      ProductImage: "ProductImage",
      CustomerGroup: "CustomerGroup",
      Customer: "Customer",
      Transaction: "Transaction",
      TransactionItem: "TransactionItem",
      Payment: "Payment",
      InventoryTransaction: "InventoryTransaction",
      ImportReceipt: "ImportReceipt",
      ImportReceiptItem: "ImportReceiptItem",
      Promotion: "Promotion",
      Supplier: "Supplier",
      PurchaseOrder: "PurchaseOrder",
      PurchaseOrderItem: "PurchaseOrderItem",
      Expense: "Expense",
      Notification: "Notification",
      Warranty: "Warranty",
      Repair: "Repair",
      Quotation: "Quotation",
      AuditLog: "AuditLog",
      PriceHistory: "PriceHistory",
      ShippingOrder: "ShippingOrder",
      Driver: "Driver",
      TaxConfig: "TaxConfig",
      TaxDeclaration: "TaxDeclaration",
      CustomerSegment: "CustomerSegment",
      Currency: "Currency",
      Feedback: "Feedback",
      Schedule: "Schedule",
      ReturnOrder: "ReturnOrder",
      ReturnItem: "ReturnItem",
      DebtEntry: "DebtEntry",
      Bundle: "Bundle",
      SalesOrder: "SalesOrder",
      SalesOrderItem: "SalesOrderItem",
      PriceList: "PriceList",
      PriceRule: "PriceRule",
      Announcement: "Announcement",
      Attendance: "Attendance",
      LoyaltyMember: "LoyaltyMember",
      LoyaltyTransaction: "LoyaltyTransaction",
      Review: "Review",
      StoreSettings: "StoreSettings",
      Store: "Store",
      BranchRequest: "BranchRequest",
      BranchDeleteRequest: "BranchDeleteRequest",
      PayrollRecord: "PayrollRecord",
      OnlineChannel: "OnlineChannel",
      OnlineOrder: "OnlineOrder",
      OnlineOrderItem: "OnlineOrderItem",
      SyncLog: "SyncLog"
    };
    var config = {
      "generator": {
        "name": "client",
        "provider": {
          "fromEnvVar": null,
          "value": "prisma-client-js"
        },
        "output": {
          "value": "C:\\Users\\ADMIN\\.gemini\\antigravity\\scratch\\open-retail-api\\src\\generated\\store-client",
          "fromEnvVar": null
        },
        "config": {
          "engineType": "library"
        },
        "binaryTargets": [
          {
            "fromEnvVar": null,
            "value": "windows",
            "native": true
          }
        ],
        "previewFeatures": [],
        "sourceFilePath": "C:\\Users\\ADMIN\\.gemini\\antigravity\\scratch\\open-retail-api\\prisma\\schema-store.prisma",
        "isCustomOutput": true
      },
      "relativeEnvPaths": {
        "rootEnvPath": null,
        "schemaEnvPath": "../../../.env"
      },
      "relativePath": "../../../prisma",
      "clientVersion": "6.19.2",
      "engineVersion": "c2990dca591cba766e3b7ef5d9e8a84796e47ab7",
      "datasourceNames": [
        "db"
      ],
      "activeProvider": "postgresql",
      "postinstall": false,
      "inlineDatasources": {
        "db": {
          "url": {
            "fromEnvVar": "STORE_DATABASE_URL",
            "value": null
          }
        }
      },
      "inlineSchema": '// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n// Store-Specific Schema \u2014 Each store gets its own PostgreSQL schema\n// All models here are per-store (no storeId needed)\n// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n\ngenerator client {\n  provider = "prisma-client-js"\n  output   = "../src/generated/store-client"\n}\n\ndatasource db {\n  provider = "postgresql"\n  url      = env("STORE_DATABASE_URL")\n}\n\n// \u2500\u2500\u2500 Branch (Chi nh\xE1nh) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel Branch {\n  id           String   @id @default(cuid())\n  name         String\n  code         String   @unique\n  isMainBranch Boolean  @default(false)\n  address      String?\n  phone        String?\n  status       String   @default("active")\n  createdAt    DateTime @default(now())\n  updatedAt    DateTime @updatedAt\n\n  users User[]\n}\n\n// \u2500\u2500\u2500 Users (store-local) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel User {\n  id               String    @id @default(cuid())\n  email            String    @unique\n  name             String\n  password         String\n  role             String    @default("cashier")\n  phone            String?\n  avatar           String?\n  code             String?   @unique\n  salary           Float?\n  hireDate         DateTime?\n  shifts           Int       @default(0)\n  totalSales       Float     @default(0)\n  employeeStatus   String    @default("active")\n  notes            String?\n  isLocked         Boolean   @default(false)\n  twoFactorEnabled Boolean   @default(false)\n  branchId         String?\n  branch           Branch?   @relation(fields: [branchId], references: [id])\n  createdAt        DateTime  @default(now())\n  updatedAt        DateTime  @updatedAt\n\n  transactions          Transaction[]\n  inventoryTransactions InventoryTransaction[]\n  importReceipts        ImportReceipt[]\n  apiKeys               ApiKey[]\n  salesCheckins         SalesCheckin[]\n  salesOrders           SalesOrder[]\n\n  @@index([branchId])\n  @@index([role])\n  @@index([employeeStatus])\n}\n\n// \u2500\u2500\u2500 API Keys \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel ApiKey {\n  id         String    @id @default(cuid())\n  name       String\n  keyId      String    @unique\n  secretHash String\n  lastFour   String\n  scopes     String    @default("read")\n  isActive   Boolean   @default(true)\n  lastUsedAt DateTime?\n  expiresAt  DateTime?\n  userId     String\n  user       User      @relation(fields: [userId], references: [id])\n  createdAt  DateTime  @default(now())\n}\n\n// \u2500\u2500\u2500 Sales Staff Tracking \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel SalesCheckin {\n  id           String    @id @default(cuid())\n  userId       String\n  user         User      @relation(fields: [userId], references: [id])\n  type         String\n  latitude     Float\n  longitude    Float\n  address      String?\n  note         String?\n  photo        String?\n  customerId   String?\n  customer     Customer? @relation(fields: [customerId], references: [id])\n  customerName String?\n  createdAt    DateTime  @default(now())\n\n  @@index([userId])\n  @@index([createdAt])\n  @@index([customerId])\n}\n\n// \u2500\u2500\u2500 Products \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel Category {\n  id          String     @id @default(cuid())\n  name        String\n  description String?\n  color       String?\n  level       Int        @default(1)\n  parentId    String?\n  parent      Category?  @relation("CategoryTree", fields: [parentId], references: [id])\n  children    Category[] @relation("CategoryTree")\n  createdAt   DateTime   @default(now())\n\n  products Product[]\n}\n\nmodel Brand {\n  id          String   @id @default(cuid())\n  name        String\n  description String?\n  logo        String?\n  createdAt   DateTime @default(now())\n\n  products Product[]\n}\n\nmodel Product {\n  id           String   @id @default(cuid())\n  name         String\n  sku          String   @unique\n  barcode      String?\n  description  String?\n  categoryId   String\n  brandId      String?\n  productType  String   @default("goods") // "goods" | "service"\n  costPrice    Float    @default(0)\n  sellingPrice Float    @default(0)\n  taxInclusive Boolean  @default(false)\n  stock        Int      @default(0)\n  minStock     Int      @default(0)\n  maxStock     Int      @default(0)\n  baseUnit     String   @default("c\xE1i")\n  trackSerial  Boolean  @default(false)\n  createdAt    DateTime @default(now())\n  updatedAt    DateTime @updatedAt\n\n  category           Category               @relation(fields: [categoryId], references: [id])\n  brand              Brand?                 @relation(fields: [brandId], references: [id])\n  unitConversions    UnitConversion[]\n  images             ProductImage[]\n  transactionItems   TransactionItem[]\n  inventoryTx        InventoryTransaction[]\n  importReceiptItems ImportReceiptItem[]\n  salesOrderItems    SalesOrderItem[]\n  serials            ProductSerial[]\n  onlineOrderItems   OnlineOrderItem[]\n\n  @@index([categoryId])\n  @@index([brandId])\n  @@index([barcode])\n  @@index([productType])\n}\n\nmodel ProductSerial {\n  id        String    @id @default(cuid())\n  productId String\n  serial    String\n  status    String    @default("in_stock")\n  soldAt    DateTime?\n  note      String?\n  createdAt DateTime  @default(now())\n\n  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)\n\n  @@unique([productId, serial])\n  @@index([productId])\n  @@index([serial])\n  @@index([status])\n}\n\nmodel UnitConversion {\n  id             String @id @default(cuid())\n  productId      String\n  fromUnit       String\n  toUnit         String\n  conversionRate Float\n\n  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)\n}\n\nmodel ProductImage {\n  id        String  @id @default(cuid())\n  productId String\n  url       String\n  isPrimary Boolean @default(false)\n\n  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)\n}\n\n// \u2500\u2500\u2500 Customers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel CustomerGroup {\n  id       String @id @default(cuid())\n  name     String\n  discount Float  @default(0)\n  color    String @default("#6b7280")\n\n  customers Customer[]\n}\n\nmodel Customer {\n  id               String    @id @default(cuid())\n  code             String    @unique\n  name             String\n  phone            String\n  email            String?\n  address          String?\n  groupId          String?\n  birthday         String?\n  gender           String?\n  notes            String?\n  totalPurchases   Float     @default(0)\n  totalOrders      Int       @default(0)\n  debt             Float     @default(0)\n  loyaltyPoints    Int       @default(0)\n  tier             String    @default("bronze")\n  lastPurchaseDate DateTime?\n  createdAt        DateTime  @default(now())\n  updatedAt        DateTime  @updatedAt\n\n  group         CustomerGroup? @relation(fields: [groupId], references: [id])\n  transactions  Transaction[]\n  salesCheckins SalesCheckin[]\n  salesOrders   SalesOrder[]\n\n  @@index([groupId])\n  @@index([phone])\n  @@index([tier])\n}\n\n// \u2500\u2500\u2500 Transactions \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel Transaction {\n  id               String    @id @default(cuid())\n  receiptNumber    String    @unique\n  customerId       String?\n  customerName     String?\n  customerPhone    String?\n  branchId         String?\n  subtotal         Float     @default(0)\n  discount         Float     @default(0)\n  tax              Float     @default(0)\n  total            Float     @default(0)\n  amountReceived   Float     @default(0)\n  change           Float     @default(0)\n  status           String    @default("completed")\n  createdBy        String\n  createdByName    String?\n  notes            String?\n  returnedAt       DateTime?\n  returnReason     String?\n  transactionDate  DateTime?\n  vatInvoiceNumber String?\n  vatIssuedAt      DateTime?\n  vatStatus        String    @default("none")\n  createdAt        DateTime  @default(now())\n\n  creator  User              @relation(fields: [createdBy], references: [id])\n  customer Customer?         @relation(fields: [customerId], references: [id])\n  items    TransactionItem[]\n  payments Payment[]\n\n  @@index([branchId])\n  @@index([createdAt])\n  @@index([status])\n  @@index([customerId])\n  @@index([createdBy])\n}\n\nmodel TransactionItem {\n  id            String @id @default(cuid())\n  transactionId String\n  productId     String\n  productName   String\n  sku           String\n  quantity      Int\n  unitPrice     Float\n  discount      Float  @default(0)\n  lineTotal     Float\n\n  transaction Transaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)\n  product     Product     @relation(fields: [productId], references: [id])\n\n  @@index([transactionId])\n  @@index([productId])\n}\n\nmodel Payment {\n  id            String  @id @default(cuid())\n  transactionId String\n  type          String\n  amount        Float\n  reference     String?\n\n  transaction Transaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)\n\n  @@index([transactionId])\n}\n\n// \u2500\u2500\u2500 Inventory \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel InventoryTransaction {\n  id              String    @id @default(cuid())\n  type            String\n  productId       String\n  productName     String\n  productSku      String\n  quantity        Int\n  reason          String\n  note            String?\n  referenceId     String?\n  referenceType   String?\n  unitPrice       Float?\n  costPriceAfter  Float?\n  supplierId      String?\n  supplierName    String?\n  branchId        String?\n  userId          String?\n  userName        String\n  transactionDate DateTime?\n  createdAt       DateTime  @default(now())\n\n  product Product @relation(fields: [productId], references: [id])\n  user    User?   @relation(fields: [userId], references: [id])\n\n  @@index([branchId])\n  @@index([productId])\n  @@index([createdAt])\n  @@index([referenceId])\n  @@index([referenceType])\n}\n\nmodel ImportReceipt {\n  id              String    @id @default(cuid())\n  code            String    @unique\n  supplierId      String?\n  supplierName    String?\n  totalCost       Float     @default(0)\n  totalItems      Int       @default(0)\n  status          String    @default("draft")\n  note            String?\n  branchId        String?\n  userId          String\n  userName        String\n  transactionDate DateTime?\n  createdAt       DateTime  @default(now())\n  updatedAt       DateTime  @updatedAt\n\n  user  User                @relation(fields: [userId], references: [id])\n  items ImportReceiptItem[]\n\n  @@index([branchId])\n  @@index([supplierId])\n  @@index([createdAt])\n  @@index([status])\n}\n\nmodel ImportReceiptItem {\n  id          String @id @default(cuid())\n  receiptId   String\n  productId   String\n  productName String\n  productSku  String\n  quantity    Int\n  costPrice   Float\n  total       Float\n\n  receipt ImportReceipt @relation(fields: [receiptId], references: [id], onDelete: Cascade)\n  product Product       @relation(fields: [productId], references: [id])\n}\n\n// \u2500\u2500\u2500 Promotions \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel Promotion {\n  id            String   @id @default(cuid())\n  code          String   @unique\n  name          String\n  description   String?\n  type          String\n  value         Float\n  minOrderValue Float?\n  maxDiscount   Float?\n  startDate     DateTime\n  endDate       DateTime\n  status        String   @default("active")\n  usageCount    Int      @default(0)\n  usageLimit    Int?\n  applicableTo  String   @default("all")\n  categoryIds   String?\n  productIds    String?\n  createdAt     DateTime @default(now())\n  updatedAt     DateTime @updatedAt\n}\n\n// \u2500\u2500\u2500 Suppliers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel Supplier {\n  id          String   @id @default(cuid())\n  code        String   @unique\n  name        String\n  contactName String?\n  phone       String?\n  email       String?\n  address     String?\n  taxCode     String?\n  totalOrders Int      @default(0)\n  totalValue  Float    @default(0)\n  status      String   @default("active")\n  notes       String?\n  createdAt   DateTime @default(now())\n  updatedAt   DateTime @updatedAt\n\n  purchaseOrders PurchaseOrder[]\n}\n\n// \u2500\u2500\u2500 Purchase Orders \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel PurchaseOrder {\n  id           String    @id @default(cuid())\n  code         String    @unique\n  supplierId   String?\n  supplierName String\n  status       String    @default("draft")\n  totalAmount  Float     @default(0)\n  notes        String?\n  expectedDate DateTime?\n  receivedDate DateTime?\n  createdAt    DateTime  @default(now())\n  updatedAt    DateTime  @updatedAt\n\n  supplier Supplier?           @relation(fields: [supplierId], references: [id])\n  items    PurchaseOrderItem[]\n}\n\nmodel PurchaseOrderItem {\n  id              String  @id @default(cuid())\n  purchaseOrderId String\n  productName     String\n  sku             String?\n  quantity        Int\n  unitPrice       Float\n\n  purchaseOrder PurchaseOrder @relation(fields: [purchaseOrderId], references: [id], onDelete: Cascade)\n}\n\n// \u2500\u2500\u2500 Expenses \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel Expense {\n  id          String   @id @default(cuid())\n  description String\n  amount      Float\n  category    String\n  date        DateTime @default(now())\n  paidBy      String?\n  recurring   Boolean  @default(false)\n  branchId    String?\n  createdAt   DateTime @default(now())\n  updatedAt   DateTime @updatedAt\n\n  @@index([branchId])\n}\n\n// \u2500\u2500\u2500 Notifications \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel Notification {\n  id        String   @id @default(cuid())\n  title     String\n  message   String\n  type      String   @default("info")\n  read      Boolean  @default(false)\n  userId    String?\n  createdAt DateTime @default(now())\n}\n\n// \u2500\u2500\u2500 Warranty \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel Warranty {\n  id            String   @id @default(cuid())\n  code          String   @unique\n  productId     String?\n  productName   String\n  customerName  String\n  customerPhone String?\n  serialNumber  String?\n  startDate     DateTime\n  endDate       DateTime\n  status        String   @default("active")\n  notes         String?\n  createdAt     DateTime @default(now())\n  updatedAt     DateTime @updatedAt\n}\n\n// \u2500\u2500\u2500 Repairs \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel Repair {\n  id            String    @id @default(cuid())\n  code          String    @unique\n  productName   String\n  customerName  String\n  customerPhone String?\n  issue         String\n  status        String    @default("received")\n  cost          Float     @default(0)\n  estimatedDate DateTime?\n  completedDate DateTime?\n  notes         String?\n  createdAt     DateTime  @default(now())\n  updatedAt     DateTime  @updatedAt\n}\n\n// \u2500\u2500\u2500 Quotations \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel Quotation {\n  id            String    @id @default(cuid())\n  code          String    @unique\n  customerName  String\n  customerPhone String?\n  items         String\n  totalAmount   Float     @default(0)\n  status        String    @default("draft")\n  validUntil    DateTime?\n  notes         String?\n  createdAt     DateTime  @default(now())\n  updatedAt     DateTime  @updatedAt\n}\n\n// \u2500\u2500\u2500 Audit Log \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel AuditLog {\n  id        String   @id @default(cuid())\n  userId    String?\n  userName  String?\n  action    String\n  entity    String\n  entityId  String?\n  details   String?\n  ipAddress String?\n  createdAt DateTime @default(now())\n\n  @@index([createdAt])\n  @@index([entity])\n  @@index([userId])\n}\n\n// \u2500\u2500\u2500 Price History \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel PriceHistory {\n  id          String   @id @default(cuid())\n  productId   String\n  productName String\n  productSku  String?\n  oldPrice    Float\n  newPrice    Float\n  changedBy   String?\n  reason      String?\n  createdAt   DateTime @default(now())\n\n  @@index([productId])\n  @@index([createdAt])\n}\n\n// \u2500\u2500\u2500 Shipping \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel ShippingOrder {\n  id            String    @id @default(cuid())\n  code          String    @unique\n  transactionId String?\n  customerName  String\n  customerPhone String?\n  address       String\n  driverId      String?\n  driverName    String?\n  status        String    @default("pending")\n  shippingFee   Float     @default(0)\n  cod           Float     @default(0)\n  notes         String?\n  estimatedDate DateTime?\n  deliveredDate DateTime?\n  branchId      String?\n  createdAt     DateTime  @default(now())\n  updatedAt     DateTime  @updatedAt\n\n  @@index([branchId])\n}\n\n// \u2500\u2500\u2500 Drivers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel Driver {\n  id              String   @id @default(cuid())\n  code            String   @unique\n  name            String\n  phone           String\n  vehicleType     String?\n  vehiclePlate    String?\n  status          String   @default("active")\n  totalDeliveries Int      @default(0)\n  rating          Float    @default(5.0)\n  notes           String?\n  createdAt       DateTime @default(now())\n  updatedAt       DateTime @updatedAt\n}\n\n// \u2500\u2500\u2500 Tax Config \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel TaxConfig {\n  id          String  @id @default(cuid())\n  name        String\n  rate        Float\n  description String?\n  isDefault   Boolean @default(false)\n  status      String  @default("active")\n}\n\n// \u2500\u2500\u2500 Tax Declaration \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel TaxDeclaration {\n  id             String    @id @default(cuid())\n  formType       String    @default("01_GTGT")\n  period         String    @unique\n  periodType     String    @default("month")\n  year           Int\n  month          Int?\n  quarter        Int?\n  taxCode        String\n  companyName    String\n  companyAddress String?\n  businessType   String    @default("company")\n  ct21           Float     @default(0)\n  ct22           Float     @default(0)\n  ct23           Float     @default(0)\n  ct24           Float     @default(0)\n  ct25           Float     @default(0)\n  ct26           Float     @default(0)\n  ct27           Float     @default(0)\n  ct28           Float     @default(0)\n  ct29           Float     @default(0)\n  ct30           Float     @default(0)\n  ct31           Float     @default(0)\n  ct32           Float     @default(0)\n  ct33           Float     @default(0)\n  ct34           Float     @default(0)\n  ct35           Float     @default(0)\n  ct36           Float     @default(0)\n  ct37           Float     @default(0)\n  ct38           Float     @default(0)\n  ct39           Float     @default(0)\n  ct40a          Float     @default(0)\n  ct40b          Float     @default(0)\n  cnkdRevenue    Float     @default(0)\n  cnkdVatRate    Float     @default(1)\n  cnkdVatAmount  Float     @default(0)\n  cnkdPitRate    Float     @default(0.5)\n  cnkdPitAmount  Float     @default(0)\n  cnkdTotalTax   Float     @default(0)\n  cnkdThreshold  Float     @default(500000000)\n  status         String    @default("draft")\n  filedAt        DateTime?\n  notes          String?\n  createdAt      DateTime  @default(now())\n  updatedAt      DateTime  @updatedAt\n\n  @@index([year])\n  @@index([status])\n  @@index([formType])\n}\n\n// \u2500\u2500\u2500 Customer Segments \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel CustomerSegment {\n  id            String   @id @default(cuid())\n  name          String\n  description   String?\n  conditions    String\n  customerCount Int      @default(0)\n  color         String   @default("#6b7280")\n  createdAt     DateTime @default(now())\n  updatedAt     DateTime @updatedAt\n}\n\n// \u2500\u2500\u2500 Currency \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel Currency {\n  id        String   @id @default(cuid())\n  code      String   @unique\n  name      String\n  symbol    String\n  rate      Float    @default(1)\n  isBase    Boolean  @default(false)\n  status    String   @default("active")\n  updatedAt DateTime @updatedAt\n}\n\n// \u2500\u2500\u2500 Feedback / Reviews \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel Feedback {\n  id            String   @id @default(cuid())\n  customerName  String?\n  customerPhone String?\n  type          String   @default("general")\n  rating        Int?\n  message       String\n  status        String   @default("new")\n  response      String?\n  createdAt     DateTime @default(now())\n  updatedAt     DateTime @updatedAt\n}\n\n// \u2500\u2500\u2500 Schedule \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel Schedule {\n  id        String   @id @default(cuid())\n  userId    String?\n  userName  String\n  date      DateTime\n  shift     String\n  status    String   @default("scheduled")\n  notes     String?\n  branchId  String?\n  createdAt DateTime @default(now())\n  updatedAt DateTime @updatedAt\n\n  @@index([branchId])\n}\n\n// \u2500\u2500\u2500 Returns \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel ReturnOrder {\n  id              String    @id @default(cuid())\n  code            String    @unique\n  originalInvoice String\n  transactionId   String?\n  customerName    String\n  customerPhone   String?\n  status          String    @default("pending") // pending, approved, rejected, processing, refunded, exchanged\n  reason          String\n  refundMethod    String? // cash, bank_transfer, store_credit, exchange\n  refundAmount    Float     @default(0)\n  totalRefund     Float     @default(0)\n  notes           String?\n  staffName       String?\n  branchId        String?\n  processedAt     DateTime?\n  refundedAt      DateTime?\n  createdAt       DateTime  @default(now())\n  updatedAt       DateTime  @updatedAt\n\n  items ReturnItem[]\n\n  @@index([branchId])\n  @@index([status])\n  @@index([createdAt])\n}\n\nmodel ReturnItem {\n  id            String  @id @default(cuid())\n  returnOrderId String\n  productId     String?\n  productName   String\n  sku           String?\n  quantity      Int\n  unitPrice     Float\n  returnReason  String?\n  condition     String? // new, used, damaged, defective\n  restocked     Boolean @default(false)\n\n  returnOrder ReturnOrder @relation(fields: [returnOrderId], references: [id], onDelete: Cascade)\n\n  @@index([returnOrderId])\n  @@index([productId])\n}\n\n// \u2500\u2500\u2500 Debt Ledger \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel DebtEntry {\n  id           String   @id @default(cuid())\n  customerId   String\n  customerName String\n  phone        String?\n  type         String\n  amount       Float\n  description  String\n  balance      Float    @default(0)\n  createdAt    DateTime @default(now())\n\n  @@index([customerId])\n  @@index([createdAt])\n}\n\n// \u2500\u2500\u2500 Bundles / Combos \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel Bundle {\n  id            String    @id @default(cuid())\n  name          String\n  category      String?\n  items         String\n  originalTotal Float     @default(0)\n  bundlePrice   Float     @default(0)\n  discount      Float     @default(0)\n  active        Boolean   @default(true)\n  soldCount     Int       @default(0)\n  validUntil    DateTime?\n  maxUsage      Int?\n  createdAt     DateTime  @default(now())\n  updatedAt     DateTime  @updatedAt\n}\n\n// \u2500\u2500\u2500 Sales Orders \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel SalesOrder {\n  id           String   @id @default(cuid())\n  orderNumber  String   @unique\n  status       String   @default("pending")\n  salesUserId  String\n  customerId   String?\n  customerName String?\n  note         String?\n  subtotal     Float    @default(0)\n  discount     Float    @default(0)\n  total        Float    @default(0)\n  branchId     String?\n  createdAt    DateTime @default(now())\n  updatedAt    DateTime @updatedAt\n\n  salesUser User             @relation(fields: [salesUserId], references: [id])\n  customer  Customer?        @relation(fields: [customerId], references: [id])\n  items     SalesOrderItem[]\n\n  @@index([branchId])\n}\n\nmodel SalesOrderItem {\n  id           String @id @default(cuid())\n  salesOrderId String\n  productId    String\n  productName  String\n  sku          String\n  quantity     Int\n  unitPrice    Float\n  lineTotal    Float\n\n  salesOrder SalesOrder @relation(fields: [salesOrderId], references: [id], onDelete: Cascade)\n  product    Product    @relation(fields: [productId], references: [id])\n}\n\n// \u2500\u2500\u2500 Price Lists \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel PriceList {\n  id          String   @id @default(cuid())\n  name        String\n  description String?\n  currency    String   @default("VND")\n  isDefault   Boolean  @default(false)\n  active      Boolean  @default(true)\n  createdAt   DateTime @default(now())\n  updatedAt   DateTime @updatedAt\n\n  rules PriceRule[]\n}\n\nmodel PriceRule {\n  id            String    @id @default(cuid())\n  priceListId   String\n  name          String\n  type          String\n  value         Float\n  scope         String    @default("all")\n  scopeIds      String?\n  appliesTo     String    @default("sellingPrice")\n  priority      Int       @default(1)\n  startDate     DateTime  @default(now())\n  endDate       DateTime?\n  active        Boolean   @default(true)\n  customerGroup String?\n  minQty        Int?\n  note          String?\n  createdAt     DateTime  @default(now())\n\n  priceList PriceList @relation(fields: [priceListId], references: [id], onDelete: Cascade)\n\n  @@index([priceListId])\n}\n\n// \u2500\u2500\u2500 Announcements \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel Announcement {\n  id        String   @id @default(cuid())\n  branchId  String?\n  title     String\n  content   String\n  priority  String   @default("info")\n  author    String\n  pinned    Boolean  @default(false)\n  archived  Boolean  @default(false)\n  createdAt DateTime @default(now())\n  updatedAt DateTime @updatedAt\n}\n\n// \u2500\u2500\u2500 Attendance \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel Attendance {\n  id        String    @id @default(cuid())\n  branchId  String?\n  userId    String\n  userName  String\n  role      String?\n  date      DateTime\n  checkIn   DateTime?\n  checkOut  DateTime?\n  status    String    @default("present")\n  note      String?\n  createdAt DateTime  @default(now())\n  updatedAt DateTime  @updatedAt\n\n  @@index([userId])\n  @@index([date])\n}\n\n// \u2500\u2500\u2500 Loyalty \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel LoyaltyMember {\n  id             String               @id @default(cuid())\n  customerId     String?\n  name           String\n  phone          String?\n  tier           String               @default("bronze")\n  totalPoints    Int                  @default(0)\n  lifetimePoints Int                  @default(0)\n  totalSpent     Float                @default(0)\n  joinDate       DateTime             @default(now())\n  createdAt      DateTime             @default(now())\n  updatedAt      DateTime             @updatedAt\n  transactions   LoyaltyTransaction[]\n\n  @@index([phone])\n}\n\nmodel LoyaltyTransaction {\n  id          String        @id @default(cuid())\n  memberId    String\n  member      LoyaltyMember @relation(fields: [memberId], references: [id], onDelete: Cascade)\n  action      String\n  amount      Int\n  description String?\n  createdAt   DateTime      @default(now())\n\n  @@index([memberId])\n}\n\n// \u2500\u2500\u2500 Reviews \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel Review {\n  id           String   @id @default(cuid())\n  productId    String?\n  productName  String\n  category     String?\n  customerName String?\n  rating       Int\n  comment      String?\n  sentiment    String?  @default("neutral")\n  createdAt    DateTime @default(now())\n  updatedAt    DateTime @updatedAt\n\n  @@index([productId])\n}\n\n// \u2500\u2500\u2500 Store Settings (replaces Store model for local config) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel StoreSettings {\n  id                 String  @id @default("default")\n  name               String\n  address            String?\n  phone              String?\n  logo               String?\n  description        String?\n  costPriceMethod    String  @default("fixed")\n  trackSerial        Boolean @default(false)\n  trackBatch         Boolean @default(false)\n  allowNegativeStock Boolean @default(false)\n  shiftConfig        String?\n  businessType       String  @default("company")\n  taxCode            String?\n  ownerName          String?\n  ownerIdNumber      String?\n  representativeName String?\n  email              String?\n  website            String?\n  notifyLowStock     Boolean @default(true)\n\n  notifyNewOrder Boolean @default(true)\n\n  notifyDailyReport Boolean @default(false)\n\n  notifyWeeklyReport Boolean @default(true)\n\n  updatedAt DateTime @updatedAt\n}\n\n// \u2500\u2500\u2500 Store (business profile for tax) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel Store {\n  id                 String   @id @default("default")\n  name               String\n  address            String?\n  phone              String?\n  email              String?\n  website            String?\n  businessType       String   @default("company")\n  taxCode            String?\n  ownerName          String?\n  ownerIdNumber      String?\n  representativeName String?\n  createdAt          DateTime @default(now())\n  updatedAt          DateTime @updatedAt\n}\n\n// \u2500\u2500\u2500 Branch Requests \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel BranchRequest {\n  id              String   @id @default(cuid())\n  storeName       String\n  branchName      String\n  branchCode      String\n  address         String?\n  phone           String?\n  status          String   @default("pending")\n  requestedBy     String\n  requestedByName String\n  reviewedBy      String?\n  reviewedByName  String?\n  reviewNote      String?\n  createdAt       DateTime @default(now())\n  updatedAt       DateTime @updatedAt\n\n  @@index([status])\n}\n\nmodel BranchDeleteRequest {\n  id              String   @id @default(cuid())\n  branchId        String\n  branchName      String\n  branchCode      String\n  storeName       String\n  reason          String?\n  status          String   @default("pending")\n  requestedBy     String\n  requestedByName String\n  reviewedBy      String?\n  reviewedByName  String?\n  reviewNote      String?\n  createdAt       DateTime @default(now())\n  updatedAt       DateTime @updatedAt\n\n  @@index([status])\n}\n\n// u2500u2500u2500 Payroll u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500\n\nmodel PayrollRecord {\n  id           String    @id @default(cuid())\n  month        Int\n  year         Int\n  employeeId   String\n  employeeName String\n  employeeCode String?\n  department   String?\n  grossSalary  Float     @default(0)\n  workdays     Int       @default(26)\n  actualDays   Int       @default(26)\n  bonus        Float     @default(0)\n  actualGross  Float     @default(0)\n  bhxh_emp     Float     @default(0)\n  bhyt_emp     Float     @default(0)\n  bhtn_emp     Float     @default(0)\n  bhxh_er      Float     @default(0)\n  bhyt_er      Float     @default(0)\n  bhtn_er      Float     @default(0)\n  pit          Float     @default(0)\n  netSalary    Float     @default(0)\n  totalCost    Float     @default(0)\n  dependents   Int       @default(0)\n  status       String    @default("draft")\n  paidAt       DateTime?\n  notes        String?\n  createdAt    DateTime  @default(now())\n  updatedAt    DateTime  @updatedAt\n\n  @@unique([employeeId, year, month])\n  @@index([year, month])\n  @@index([employeeId])\n}\n\n// \u2500\u2500\u2500 Online Sales Channels \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel OnlineChannel {\n  id             String    @id @default(cuid())\n  name           String\n  platform       String // shopee, lazada, tiktok, website, facebook, zalo, other\n  status         String    @default("active")\n  shopUrl        String?\n  apiKey         String?\n  apiSecret      String?\n  accessToken    String?\n  refreshToken   String?\n  tokenExpiresAt DateTime?\n  shopId         String?\n  webhookSecret  String?\n  syncEnabled    Boolean   @default(false)\n  lastSyncAt     DateTime?\n  totalOrders    Int       @default(0)\n  totalRevenue   Float     @default(0)\n  createdAt      DateTime  @default(now())\n  updatedAt      DateTime  @updatedAt\n\n  orders OnlineOrder[]\n\n  commissionRate Float @default(6) // % ph\xED s\xE0n m\u1EB7c \u0111\u1ECBnh\n}\n\n// \u2500\u2500\u2500 Online Orders \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel OnlineOrder {\n  id              String    @id @default(cuid())\n  orderNumber     String    @unique\n  channelId       String?\n  channelName     String?\n  platform        String?\n  customerName    String\n  customerPhone   String?\n  customerEmail   String?\n  shippingAddress String?\n  status          String    @default("pending") // pending, confirmed, processing, shipping, delivered, completed, cancelled, returned\n  subtotal        Float     @default(0)\n  discount        Float     @default(0)\n  shippingFee     Float     @default(0)\n  total           Float     @default(0)\n  paymentMethod   String?\n  paymentStatus   String    @default("unpaid") // unpaid, paid, refunded\n  paidAt          DateTime?\n  trackingNumber  String?\n  shippingCarrier String?\n  shippedAt       DateTime?\n  deliveredAt     DateTime?\n  note            String?\n  internalNote    String?\n  externalOrderId String?\n  externalStatus  String?\n  platformFee     Float     @default(0)\n  platformFeeRate Float     @default(0)\n  netRevenue      Float     @default(0)\n  syncedAt        DateTime?\n  createdAt       DateTime  @default(now())\n  updatedAt       DateTime  @updatedAt\n\n  channel OnlineChannel?    @relation(fields: [channelId], references: [id])\n  items   OnlineOrderItem[]\n\n  @@index([channelId])\n  @@index([status])\n  @@index([paymentStatus])\n  @@index([createdAt])\n  @@index([platform])\n}\n\n// \u2500\u2500\u2500 Online Order Items \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel OnlineOrderItem {\n  id            String  @id @default(cuid())\n  onlineOrderId String\n  productId     String?\n  productName   String\n  sku           String?\n  quantity      Int\n  unitPrice     Float\n  discount      Float   @default(0)\n  lineTotal     Float\n\n  onlineOrder OnlineOrder @relation(fields: [onlineOrderId], references: [id], onDelete: Cascade)\n  product     Product?    @relation(fields: [productId], references: [id])\n\n  @@index([onlineOrderId])\n  @@index([productId])\n}\n\n// \u2500\u2500\u2500 Sync Logs \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nmodel SyncLog {\n  id          String   @id @default(cuid())\n  channelId   String\n  action      String // sync_orders, update_status, webhook, test_connection\n  status      String // success, error\n  details     String?\n  ordersCount Int      @default(0)\n  createdAt   DateTime @default(now())\n\n  @@index([channelId, createdAt])\n}\n',
      "inlineSchemaHash": "8cd26f6d5b4b73597f5df47720c33036b4b933dfd9c93ab19067709efbdaa774",
      "copyEngine": true
    };
    var fs = require("fs");
    config.dirname = __dirname;
    if (!fs.existsSync(path.join(__dirname, "schema.prisma"))) {
      const alternativePaths = [
        "src/generated/store-client",
        "generated/store-client"
      ];
      const alternativePath = alternativePaths.find((altPath) => {
        return fs.existsSync(path.join(process.cwd(), altPath, "schema.prisma"));
      }) ?? alternativePaths[0];
      config.dirname = path.join(process.cwd(), alternativePath);
      config.isBundled = true;
    }
    config.runtimeDataModel = JSON.parse('{"models":{"Branch":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"name","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"code","kind":"scalar","isList":false,"isRequired":true,"isUnique":true,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"isMainBranch","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":false,"isGenerated":false,"isUpdatedAt":false},{"name":"address","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"phone","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"active","isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true},{"name":"users","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"User","nativeType":null,"relationName":"BranchToUser","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"User":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"email","kind":"scalar","isList":false,"isRequired":true,"isUnique":true,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"name","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"password","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"role","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"cashier","isGenerated":false,"isUpdatedAt":false},{"name":"phone","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"avatar","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"code","kind":"scalar","isList":false,"isRequired":false,"isUnique":true,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"salary","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"hireDate","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"shifts","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Int","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"totalSales","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"employeeStatus","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"active","isGenerated":false,"isUpdatedAt":false},{"name":"notes","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"isLocked","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":false,"isGenerated":false,"isUpdatedAt":false},{"name":"twoFactorEnabled","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":false,"isGenerated":false,"isUpdatedAt":false},{"name":"branchId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"branch","kind":"object","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Branch","nativeType":null,"relationName":"BranchToUser","relationFromFields":["branchId"],"relationToFields":["id"],"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true},{"name":"transactions","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Transaction","nativeType":null,"relationName":"TransactionToUser","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false},{"name":"inventoryTransactions","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"InventoryTransaction","nativeType":null,"relationName":"InventoryTransactionToUser","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false},{"name":"importReceipts","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"ImportReceipt","nativeType":null,"relationName":"ImportReceiptToUser","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false},{"name":"apiKeys","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"ApiKey","nativeType":null,"relationName":"ApiKeyToUser","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false},{"name":"salesCheckins","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"SalesCheckin","nativeType":null,"relationName":"SalesCheckinToUser","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false},{"name":"salesOrders","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"SalesOrder","nativeType":null,"relationName":"SalesOrderToUser","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"ApiKey":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"name","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"keyId","kind":"scalar","isList":false,"isRequired":true,"isUnique":true,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"secretHash","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"lastFour","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"scopes","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"read","isGenerated":false,"isUpdatedAt":false},{"name":"isActive","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":true,"isGenerated":false,"isUpdatedAt":false},{"name":"lastUsedAt","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"expiresAt","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"userId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"user","kind":"object","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"User","nativeType":null,"relationName":"ApiKeyToUser","relationFromFields":["userId"],"relationToFields":["id"],"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"SalesCheckin":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"userId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"user","kind":"object","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"User","nativeType":null,"relationName":"SalesCheckinToUser","relationFromFields":["userId"],"relationToFields":["id"],"isGenerated":false,"isUpdatedAt":false},{"name":"type","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"latitude","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"longitude","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"address","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"note","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"photo","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"customerId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"customer","kind":"object","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Customer","nativeType":null,"relationName":"CustomerToSalesCheckin","relationFromFields":["customerId"],"relationToFields":["id"],"isGenerated":false,"isUpdatedAt":false},{"name":"customerName","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"Category":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"name","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"description","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"color","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"level","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Int","nativeType":null,"default":1,"isGenerated":false,"isUpdatedAt":false},{"name":"parentId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"parent","kind":"object","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Category","nativeType":null,"relationName":"CategoryTree","relationFromFields":["parentId"],"relationToFields":["id"],"isGenerated":false,"isUpdatedAt":false},{"name":"children","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Category","nativeType":null,"relationName":"CategoryTree","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"products","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Product","nativeType":null,"relationName":"CategoryToProduct","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"Brand":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"name","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"description","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"logo","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"products","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Product","nativeType":null,"relationName":"BrandToProduct","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"Product":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"name","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"sku","kind":"scalar","isList":false,"isRequired":true,"isUnique":true,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"barcode","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"description","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"categoryId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"brandId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"productType","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"goods","isGenerated":false,"isUpdatedAt":false},{"name":"costPrice","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"sellingPrice","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"taxInclusive","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":false,"isGenerated":false,"isUpdatedAt":false},{"name":"stock","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Int","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"minStock","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Int","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"maxStock","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Int","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"baseUnit","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"c\xE1i","isGenerated":false,"isUpdatedAt":false},{"name":"trackSerial","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":false,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true},{"name":"category","kind":"object","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Category","nativeType":null,"relationName":"CategoryToProduct","relationFromFields":["categoryId"],"relationToFields":["id"],"isGenerated":false,"isUpdatedAt":false},{"name":"brand","kind":"object","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Brand","nativeType":null,"relationName":"BrandToProduct","relationFromFields":["brandId"],"relationToFields":["id"],"isGenerated":false,"isUpdatedAt":false},{"name":"unitConversions","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"UnitConversion","nativeType":null,"relationName":"ProductToUnitConversion","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false},{"name":"images","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"ProductImage","nativeType":null,"relationName":"ProductToProductImage","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false},{"name":"transactionItems","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"TransactionItem","nativeType":null,"relationName":"ProductToTransactionItem","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false},{"name":"inventoryTx","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"InventoryTransaction","nativeType":null,"relationName":"InventoryTransactionToProduct","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false},{"name":"importReceiptItems","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"ImportReceiptItem","nativeType":null,"relationName":"ImportReceiptItemToProduct","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false},{"name":"salesOrderItems","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"SalesOrderItem","nativeType":null,"relationName":"ProductToSalesOrderItem","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false},{"name":"serials","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"ProductSerial","nativeType":null,"relationName":"ProductToProductSerial","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false},{"name":"onlineOrderItems","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"OnlineOrderItem","nativeType":null,"relationName":"OnlineOrderItemToProduct","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"ProductSerial":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"productId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"serial","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"in_stock","isGenerated":false,"isUpdatedAt":false},{"name":"soldAt","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"note","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"product","kind":"object","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Product","nativeType":null,"relationName":"ProductToProductSerial","relationFromFields":["productId"],"relationToFields":["id"],"relationOnDelete":"Cascade","isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[["productId","serial"]],"uniqueIndexes":[{"name":null,"fields":["productId","serial"]}],"isGenerated":false},"UnitConversion":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"productId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"fromUnit","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"toUnit","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"conversionRate","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"product","kind":"object","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Product","nativeType":null,"relationName":"ProductToUnitConversion","relationFromFields":["productId"],"relationToFields":["id"],"relationOnDelete":"Cascade","isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"ProductImage":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"productId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"url","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"isPrimary","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":false,"isGenerated":false,"isUpdatedAt":false},{"name":"product","kind":"object","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Product","nativeType":null,"relationName":"ProductToProductImage","relationFromFields":["productId"],"relationToFields":["id"],"relationOnDelete":"Cascade","isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"CustomerGroup":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"name","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"discount","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"color","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"#6b7280","isGenerated":false,"isUpdatedAt":false},{"name":"customers","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Customer","nativeType":null,"relationName":"CustomerToCustomerGroup","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"Customer":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"code","kind":"scalar","isList":false,"isRequired":true,"isUnique":true,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"name","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"phone","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"email","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"address","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"groupId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"birthday","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"gender","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"notes","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"totalPurchases","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"totalOrders","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Int","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"debt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"loyaltyPoints","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Int","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"tier","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"bronze","isGenerated":false,"isUpdatedAt":false},{"name":"lastPurchaseDate","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true},{"name":"group","kind":"object","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"CustomerGroup","nativeType":null,"relationName":"CustomerToCustomerGroup","relationFromFields":["groupId"],"relationToFields":["id"],"isGenerated":false,"isUpdatedAt":false},{"name":"transactions","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Transaction","nativeType":null,"relationName":"CustomerToTransaction","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false},{"name":"salesCheckins","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"SalesCheckin","nativeType":null,"relationName":"CustomerToSalesCheckin","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false},{"name":"salesOrders","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"SalesOrder","nativeType":null,"relationName":"CustomerToSalesOrder","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"Transaction":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"receiptNumber","kind":"scalar","isList":false,"isRequired":true,"isUnique":true,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"customerId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"customerName","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"customerPhone","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"branchId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"subtotal","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"discount","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"tax","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"total","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"amountReceived","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"change","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"completed","isGenerated":false,"isUpdatedAt":false},{"name":"createdBy","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdByName","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"notes","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"returnedAt","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"returnReason","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"transactionDate","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"vatInvoiceNumber","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"vatIssuedAt","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"vatStatus","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"none","isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"creator","kind":"object","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"User","nativeType":null,"relationName":"TransactionToUser","relationFromFields":["createdBy"],"relationToFields":["id"],"isGenerated":false,"isUpdatedAt":false},{"name":"customer","kind":"object","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Customer","nativeType":null,"relationName":"CustomerToTransaction","relationFromFields":["customerId"],"relationToFields":["id"],"isGenerated":false,"isUpdatedAt":false},{"name":"items","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"TransactionItem","nativeType":null,"relationName":"TransactionToTransactionItem","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false},{"name":"payments","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Payment","nativeType":null,"relationName":"PaymentToTransaction","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"TransactionItem":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"transactionId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"productId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"productName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"sku","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"quantity","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Int","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"unitPrice","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"discount","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"lineTotal","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"transaction","kind":"object","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Transaction","nativeType":null,"relationName":"TransactionToTransactionItem","relationFromFields":["transactionId"],"relationToFields":["id"],"relationOnDelete":"Cascade","isGenerated":false,"isUpdatedAt":false},{"name":"product","kind":"object","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Product","nativeType":null,"relationName":"ProductToTransactionItem","relationFromFields":["productId"],"relationToFields":["id"],"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"Payment":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"transactionId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"type","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"amount","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"reference","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"transaction","kind":"object","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Transaction","nativeType":null,"relationName":"PaymentToTransaction","relationFromFields":["transactionId"],"relationToFields":["id"],"relationOnDelete":"Cascade","isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"InventoryTransaction":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"type","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"productId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"productName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"productSku","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"quantity","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Int","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"reason","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"note","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"referenceId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"referenceType","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"unitPrice","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"costPriceAfter","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"supplierId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"supplierName","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"branchId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"userId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"userName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"transactionDate","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"product","kind":"object","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Product","nativeType":null,"relationName":"InventoryTransactionToProduct","relationFromFields":["productId"],"relationToFields":["id"],"isGenerated":false,"isUpdatedAt":false},{"name":"user","kind":"object","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"User","nativeType":null,"relationName":"InventoryTransactionToUser","relationFromFields":["userId"],"relationToFields":["id"],"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"ImportReceipt":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"code","kind":"scalar","isList":false,"isRequired":true,"isUnique":true,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"supplierId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"supplierName","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"totalCost","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"totalItems","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Int","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"draft","isGenerated":false,"isUpdatedAt":false},{"name":"note","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"branchId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"userId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"userName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"transactionDate","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true},{"name":"user","kind":"object","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"User","nativeType":null,"relationName":"ImportReceiptToUser","relationFromFields":["userId"],"relationToFields":["id"],"isGenerated":false,"isUpdatedAt":false},{"name":"items","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"ImportReceiptItem","nativeType":null,"relationName":"ImportReceiptToImportReceiptItem","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"ImportReceiptItem":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"receiptId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"productId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"productName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"productSku","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"quantity","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Int","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"costPrice","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"total","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"receipt","kind":"object","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"ImportReceipt","nativeType":null,"relationName":"ImportReceiptToImportReceiptItem","relationFromFields":["receiptId"],"relationToFields":["id"],"relationOnDelete":"Cascade","isGenerated":false,"isUpdatedAt":false},{"name":"product","kind":"object","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Product","nativeType":null,"relationName":"ImportReceiptItemToProduct","relationFromFields":["productId"],"relationToFields":["id"],"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"Promotion":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"code","kind":"scalar","isList":false,"isRequired":true,"isUnique":true,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"name","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"description","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"type","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"value","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"minOrderValue","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"maxDiscount","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"startDate","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"endDate","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"active","isGenerated":false,"isUpdatedAt":false},{"name":"usageCount","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Int","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"usageLimit","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Int","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"applicableTo","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"all","isGenerated":false,"isUpdatedAt":false},{"name":"categoryIds","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"productIds","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"Supplier":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"code","kind":"scalar","isList":false,"isRequired":true,"isUnique":true,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"name","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"contactName","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"phone","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"email","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"address","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"taxCode","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"totalOrders","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Int","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"totalValue","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"active","isGenerated":false,"isUpdatedAt":false},{"name":"notes","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true},{"name":"purchaseOrders","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"PurchaseOrder","nativeType":null,"relationName":"PurchaseOrderToSupplier","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"PurchaseOrder":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"code","kind":"scalar","isList":false,"isRequired":true,"isUnique":true,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"supplierId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"supplierName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"draft","isGenerated":false,"isUpdatedAt":false},{"name":"totalAmount","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"notes","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"expectedDate","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"receivedDate","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true},{"name":"supplier","kind":"object","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Supplier","nativeType":null,"relationName":"PurchaseOrderToSupplier","relationFromFields":["supplierId"],"relationToFields":["id"],"isGenerated":false,"isUpdatedAt":false},{"name":"items","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"PurchaseOrderItem","nativeType":null,"relationName":"PurchaseOrderToPurchaseOrderItem","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"PurchaseOrderItem":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"purchaseOrderId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"productName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"sku","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"quantity","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Int","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"unitPrice","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"purchaseOrder","kind":"object","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"PurchaseOrder","nativeType":null,"relationName":"PurchaseOrderToPurchaseOrderItem","relationFromFields":["purchaseOrderId"],"relationToFields":["id"],"relationOnDelete":"Cascade","isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"Expense":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"description","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"amount","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"category","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"date","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"paidBy","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"recurring","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":false,"isGenerated":false,"isUpdatedAt":false},{"name":"branchId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"Notification":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"title","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"message","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"type","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"info","isGenerated":false,"isUpdatedAt":false},{"name":"read","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":false,"isGenerated":false,"isUpdatedAt":false},{"name":"userId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"Warranty":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"code","kind":"scalar","isList":false,"isRequired":true,"isUnique":true,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"productId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"productName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"customerName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"customerPhone","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"serialNumber","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"startDate","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"endDate","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"active","isGenerated":false,"isUpdatedAt":false},{"name":"notes","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"Repair":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"code","kind":"scalar","isList":false,"isRequired":true,"isUnique":true,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"productName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"customerName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"customerPhone","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"issue","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"received","isGenerated":false,"isUpdatedAt":false},{"name":"cost","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"estimatedDate","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"completedDate","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"notes","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"Quotation":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"code","kind":"scalar","isList":false,"isRequired":true,"isUnique":true,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"customerName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"customerPhone","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"items","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"totalAmount","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"draft","isGenerated":false,"isUpdatedAt":false},{"name":"validUntil","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"notes","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"AuditLog":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"userId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"userName","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"action","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"entity","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"entityId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"details","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"ipAddress","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"PriceHistory":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"productId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"productName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"productSku","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"oldPrice","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"newPrice","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"changedBy","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"reason","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"ShippingOrder":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"code","kind":"scalar","isList":false,"isRequired":true,"isUnique":true,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"transactionId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"customerName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"customerPhone","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"address","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"driverId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"driverName","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"pending","isGenerated":false,"isUpdatedAt":false},{"name":"shippingFee","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"cod","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"notes","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"estimatedDate","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"deliveredDate","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"branchId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"Driver":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"code","kind":"scalar","isList":false,"isRequired":true,"isUnique":true,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"name","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"phone","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"vehicleType","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"vehiclePlate","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"active","isGenerated":false,"isUpdatedAt":false},{"name":"totalDeliveries","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Int","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"rating","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":5,"isGenerated":false,"isUpdatedAt":false},{"name":"notes","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"TaxConfig":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"name","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"rate","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"description","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"isDefault","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":false,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"active","isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"TaxDeclaration":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"formType","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"01_GTGT","isGenerated":false,"isUpdatedAt":false},{"name":"period","kind":"scalar","isList":false,"isRequired":true,"isUnique":true,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"periodType","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"month","isGenerated":false,"isUpdatedAt":false},{"name":"year","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Int","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"month","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Int","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"quarter","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Int","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"taxCode","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"companyName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"companyAddress","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"businessType","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"company","isGenerated":false,"isUpdatedAt":false},{"name":"ct21","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"ct22","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"ct23","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"ct24","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"ct25","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"ct26","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"ct27","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"ct28","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"ct29","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"ct30","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"ct31","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"ct32","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"ct33","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"ct34","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"ct35","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"ct36","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"ct37","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"ct38","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"ct39","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"ct40a","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"ct40b","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"cnkdRevenue","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"cnkdVatRate","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":1,"isGenerated":false,"isUpdatedAt":false},{"name":"cnkdVatAmount","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"cnkdPitRate","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0.5,"isGenerated":false,"isUpdatedAt":false},{"name":"cnkdPitAmount","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"cnkdTotalTax","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"cnkdThreshold","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":500000000,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"draft","isGenerated":false,"isUpdatedAt":false},{"name":"filedAt","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"notes","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"CustomerSegment":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"name","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"description","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"conditions","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"customerCount","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Int","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"color","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"#6b7280","isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"Currency":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"code","kind":"scalar","isList":false,"isRequired":true,"isUnique":true,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"name","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"symbol","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"rate","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":1,"isGenerated":false,"isUpdatedAt":false},{"name":"isBase","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":false,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"active","isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"Feedback":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"customerName","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"customerPhone","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"type","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"general","isGenerated":false,"isUpdatedAt":false},{"name":"rating","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Int","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"message","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"new","isGenerated":false,"isUpdatedAt":false},{"name":"response","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"Schedule":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"userId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"userName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"date","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"shift","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"scheduled","isGenerated":false,"isUpdatedAt":false},{"name":"notes","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"branchId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"ReturnOrder":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"code","kind":"scalar","isList":false,"isRequired":true,"isUnique":true,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"originalInvoice","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"transactionId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"customerName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"customerPhone","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"pending","isGenerated":false,"isUpdatedAt":false},{"name":"reason","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"refundMethod","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"refundAmount","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"totalRefund","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"notes","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"staffName","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"branchId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"processedAt","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"refundedAt","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true},{"name":"items","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"ReturnItem","nativeType":null,"relationName":"ReturnItemToReturnOrder","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"ReturnItem":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"returnOrderId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"productId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"productName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"sku","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"quantity","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Int","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"unitPrice","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"returnReason","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"condition","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"restocked","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":false,"isGenerated":false,"isUpdatedAt":false},{"name":"returnOrder","kind":"object","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"ReturnOrder","nativeType":null,"relationName":"ReturnItemToReturnOrder","relationFromFields":["returnOrderId"],"relationToFields":["id"],"relationOnDelete":"Cascade","isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"DebtEntry":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"customerId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"customerName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"phone","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"type","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"amount","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"description","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"balance","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"Bundle":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"name","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"category","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"items","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"originalTotal","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"bundlePrice","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"discount","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"active","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":true,"isGenerated":false,"isUpdatedAt":false},{"name":"soldCount","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Int","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"validUntil","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"maxUsage","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Int","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"SalesOrder":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"orderNumber","kind":"scalar","isList":false,"isRequired":true,"isUnique":true,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"pending","isGenerated":false,"isUpdatedAt":false},{"name":"salesUserId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"customerId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"customerName","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"note","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"subtotal","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"discount","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"total","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"branchId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true},{"name":"salesUser","kind":"object","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"User","nativeType":null,"relationName":"SalesOrderToUser","relationFromFields":["salesUserId"],"relationToFields":["id"],"isGenerated":false,"isUpdatedAt":false},{"name":"customer","kind":"object","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Customer","nativeType":null,"relationName":"CustomerToSalesOrder","relationFromFields":["customerId"],"relationToFields":["id"],"isGenerated":false,"isUpdatedAt":false},{"name":"items","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"SalesOrderItem","nativeType":null,"relationName":"SalesOrderToSalesOrderItem","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"SalesOrderItem":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"salesOrderId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"productId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"productName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"sku","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"quantity","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Int","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"unitPrice","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"lineTotal","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"salesOrder","kind":"object","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"SalesOrder","nativeType":null,"relationName":"SalesOrderToSalesOrderItem","relationFromFields":["salesOrderId"],"relationToFields":["id"],"relationOnDelete":"Cascade","isGenerated":false,"isUpdatedAt":false},{"name":"product","kind":"object","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Product","nativeType":null,"relationName":"ProductToSalesOrderItem","relationFromFields":["productId"],"relationToFields":["id"],"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"PriceList":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"name","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"description","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"currency","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"VND","isGenerated":false,"isUpdatedAt":false},{"name":"isDefault","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":false,"isGenerated":false,"isUpdatedAt":false},{"name":"active","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":true,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true},{"name":"rules","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"PriceRule","nativeType":null,"relationName":"PriceListToPriceRule","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"PriceRule":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"priceListId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"name","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"type","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"value","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"scope","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"all","isGenerated":false,"isUpdatedAt":false},{"name":"scopeIds","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"appliesTo","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"sellingPrice","isGenerated":false,"isUpdatedAt":false},{"name":"priority","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Int","nativeType":null,"default":1,"isGenerated":false,"isUpdatedAt":false},{"name":"startDate","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"endDate","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"active","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":true,"isGenerated":false,"isUpdatedAt":false},{"name":"customerGroup","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"minQty","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Int","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"note","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"priceList","kind":"object","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"PriceList","nativeType":null,"relationName":"PriceListToPriceRule","relationFromFields":["priceListId"],"relationToFields":["id"],"relationOnDelete":"Cascade","isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"Announcement":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"branchId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"title","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"content","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"priority","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"info","isGenerated":false,"isUpdatedAt":false},{"name":"author","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"pinned","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":false,"isGenerated":false,"isUpdatedAt":false},{"name":"archived","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":false,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"Attendance":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"branchId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"userId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"userName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"role","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"date","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"checkIn","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"checkOut","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"present","isGenerated":false,"isUpdatedAt":false},{"name":"note","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"LoyaltyMember":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"customerId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"name","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"phone","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"tier","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"bronze","isGenerated":false,"isUpdatedAt":false},{"name":"totalPoints","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Int","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"lifetimePoints","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Int","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"totalSpent","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"joinDate","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true},{"name":"transactions","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"LoyaltyTransaction","nativeType":null,"relationName":"LoyaltyMemberToLoyaltyTransaction","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"LoyaltyTransaction":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"memberId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"member","kind":"object","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"LoyaltyMember","nativeType":null,"relationName":"LoyaltyMemberToLoyaltyTransaction","relationFromFields":["memberId"],"relationToFields":["id"],"relationOnDelete":"Cascade","isGenerated":false,"isUpdatedAt":false},{"name":"action","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"amount","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Int","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"description","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"Review":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"productId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"productName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"category","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"customerName","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"rating","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Int","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"comment","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"sentiment","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"neutral","isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"StoreSettings":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"default","isGenerated":false,"isUpdatedAt":false},{"name":"name","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"address","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"phone","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"logo","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"description","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"costPriceMethod","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"fixed","isGenerated":false,"isUpdatedAt":false},{"name":"trackSerial","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":false,"isGenerated":false,"isUpdatedAt":false},{"name":"trackBatch","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":false,"isGenerated":false,"isUpdatedAt":false},{"name":"allowNegativeStock","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":false,"isGenerated":false,"isUpdatedAt":false},{"name":"shiftConfig","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"businessType","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"company","isGenerated":false,"isUpdatedAt":false},{"name":"taxCode","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"ownerName","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"ownerIdNumber","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"representativeName","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"email","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"website","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"notifyLowStock","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":true,"isGenerated":false,"isUpdatedAt":false},{"name":"notifyNewOrder","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":true,"isGenerated":false,"isUpdatedAt":false},{"name":"notifyDailyReport","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":false,"isGenerated":false,"isUpdatedAt":false},{"name":"notifyWeeklyReport","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":true,"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"Store":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"default","isGenerated":false,"isUpdatedAt":false},{"name":"name","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"address","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"phone","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"email","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"website","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"businessType","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"company","isGenerated":false,"isUpdatedAt":false},{"name":"taxCode","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"ownerName","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"ownerIdNumber","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"representativeName","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"BranchRequest":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"storeName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"branchName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"branchCode","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"address","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"phone","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"pending","isGenerated":false,"isUpdatedAt":false},{"name":"requestedBy","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"requestedByName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"reviewedBy","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"reviewedByName","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"reviewNote","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"BranchDeleteRequest":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"branchId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"branchName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"branchCode","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"storeName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"reason","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"pending","isGenerated":false,"isUpdatedAt":false},{"name":"requestedBy","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"requestedByName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"reviewedBy","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"reviewedByName","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"reviewNote","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"PayrollRecord":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"month","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Int","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"year","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Int","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"employeeId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"employeeName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"employeeCode","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"department","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"grossSalary","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"workdays","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Int","nativeType":null,"default":26,"isGenerated":false,"isUpdatedAt":false},{"name":"actualDays","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Int","nativeType":null,"default":26,"isGenerated":false,"isUpdatedAt":false},{"name":"bonus","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"actualGross","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"bhxh_emp","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"bhyt_emp","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"bhtn_emp","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"bhxh_er","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"bhyt_er","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"bhtn_er","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"pit","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"netSalary","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"totalCost","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"dependents","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Int","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"draft","isGenerated":false,"isUpdatedAt":false},{"name":"paidAt","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"notes","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true}],"primaryKey":null,"uniqueFields":[["employeeId","year","month"]],"uniqueIndexes":[{"name":null,"fields":["employeeId","year","month"]}],"isGenerated":false},"OnlineChannel":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"name","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"platform","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"active","isGenerated":false,"isUpdatedAt":false},{"name":"shopUrl","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"apiKey","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"apiSecret","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"accessToken","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"refreshToken","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"tokenExpiresAt","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"shopId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"webhookSecret","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"syncEnabled","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Boolean","nativeType":null,"default":false,"isGenerated":false,"isUpdatedAt":false},{"name":"lastSyncAt","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"totalOrders","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Int","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"totalRevenue","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true},{"name":"orders","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"OnlineOrder","nativeType":null,"relationName":"OnlineChannelToOnlineOrder","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false},{"name":"commissionRate","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":6,"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"OnlineOrder":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"orderNumber","kind":"scalar","isList":false,"isRequired":true,"isUnique":true,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"channelId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"channelName","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"platform","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"customerName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"customerPhone","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"customerEmail","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"shippingAddress","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"pending","isGenerated":false,"isUpdatedAt":false},{"name":"subtotal","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"discount","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"shippingFee","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"total","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"paymentMethod","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"paymentStatus","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":"unpaid","isGenerated":false,"isUpdatedAt":false},{"name":"paidAt","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"trackingNumber","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"shippingCarrier","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"shippedAt","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"deliveredAt","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"note","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"internalNote","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"externalOrderId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"externalStatus","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"platformFee","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"platformFeeRate","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"netRevenue","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"syncedAt","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false},{"name":"updatedAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"DateTime","nativeType":null,"isGenerated":false,"isUpdatedAt":true},{"name":"channel","kind":"object","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"OnlineChannel","nativeType":null,"relationName":"OnlineChannelToOnlineOrder","relationFromFields":["channelId"],"relationToFields":["id"],"isGenerated":false,"isUpdatedAt":false},{"name":"items","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"OnlineOrderItem","nativeType":null,"relationName":"OnlineOrderToOnlineOrderItem","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"OnlineOrderItem":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"onlineOrderId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"productId","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"productName","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"sku","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"quantity","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Int","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"unitPrice","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"discount","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Float","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"lineTotal","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Float","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"onlineOrder","kind":"object","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"OnlineOrder","nativeType":null,"relationName":"OnlineOrderToOnlineOrderItem","relationFromFields":["onlineOrderId"],"relationToFields":["id"],"relationOnDelete":"Cascade","isGenerated":false,"isUpdatedAt":false},{"name":"product","kind":"object","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Product","nativeType":null,"relationName":"OnlineOrderItemToProduct","relationFromFields":["productId"],"relationToFields":["id"],"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},"SyncLog":{"dbName":null,"schema":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":true,"type":"String","nativeType":null,"default":{"name":"cuid","args":[1]},"isGenerated":false,"isUpdatedAt":false},{"name":"channelId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"action","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"status","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"details","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","nativeType":null,"isGenerated":false,"isUpdatedAt":false},{"name":"ordersCount","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"Int","nativeType":null,"default":0,"isGenerated":false,"isUpdatedAt":false},{"name":"createdAt","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":true,"type":"DateTime","nativeType":null,"default":{"name":"now","args":[]},"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false}},"enums":{},"types":{}}');
    defineDmmfProperty2(exports2.Prisma, config.runtimeDataModel);
    config.engineWasm = void 0;
    config.compilerWasm = void 0;
    var { warnEnvConflicts: warnEnvConflicts2 } = require_library();
    warnEnvConflicts2({
      rootEnvPath: config.relativeEnvPaths.rootEnvPath && path.resolve(config.dirname, config.relativeEnvPaths.rootEnvPath),
      schemaEnvPath: config.relativeEnvPaths.schemaEnvPath && path.resolve(config.dirname, config.relativeEnvPaths.schemaEnvPath)
    });
    var PrismaClient2 = getPrismaClient2(config);
    exports2.PrismaClient = PrismaClient2;
    Object.assign(exports2, Prisma);
    path.join(__dirname, "query_engine-windows.dll.node");
    path.join(process.cwd(), "src/generated/store-client/query_engine-windows.dll.node");
    path.join(__dirname, "schema.prisma");
    path.join(process.cwd(), "src/generated/store-client/schema.prisma");
  }
});

// src/lib/bigquery.ts
var bigquery_exports = {};
__export(bigquery_exports, {
  deleteRowsSince: () => deleteRowsSince,
  ensureDataset: () => ensureDataset,
  getDatasetId: () => getDatasetId,
  insertRows: () => insertRows,
  isBigQueryEnabled: () => isBigQueryEnabled,
  queryBQ: () => queryBQ
});
async function ensureDataset() {
  if (!bq || !DATASET_ID) return;
  try {
    dataset = bq.dataset(DATASET_ID);
    const [exists] = await dataset.exists();
    if (!exists) {
      [dataset] = await bq.createDataset(DATASET_ID, { location: "asia-southeast1" });
      console.log(`\u{1F4E6} Created BigQuery dataset: ${DATASET_ID}`);
    }
    for (const [tableName, schema] of Object.entries(TABLE_SCHEMAS)) {
      const table = dataset.table(tableName);
      const [tableExists] = await table.exists();
      if (!tableExists) {
        await dataset.createTable(tableName, { schema: { fields: schema } });
        console.log(`  \u{1F4CB} Created table: ${tableName}`);
      }
    }
  } catch (err) {
    console.error("BigQuery ensureDataset error:", err.message);
  }
}
async function insertRows(tableName, rows) {
  if (!bq || !DATASET_ID || rows.length === 0) return 0;
  const table = bq.dataset(DATASET_ID).table(tableName);
  const BATCH_SIZE = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    try {
      await table.insert(batch, { skipInvalidRows: true, ignoreUnknownValues: true });
      inserted += batch.length;
    } catch (err) {
      if (err.name === "PartialFailureError") {
        const failed = err.errors?.length || 0;
        inserted += batch.length - failed;
        console.warn(`BigQuery partial insert: ${failed} rows failed in ${tableName}`);
      } else {
        console.error(`BigQuery insert error (${tableName}):`, err.message);
      }
    }
  }
  return inserted;
}
async function queryBQ(sql, params) {
  if (!bq) throw new Error("BigQuery not configured");
  const options = { query: sql, location: "asia-southeast1" };
  if (params) {
    options.params = params;
    options.parameterMode = "NAMED";
  }
  const [rows] = await bq.query(options);
  return rows;
}
async function deleteRowsSince(tableName, since, storeIdColumn = "storeId") {
  if (!bq || !DATASET_ID) return;
  const dateCol = tableName === "products_snapshot" ? "snapshotDate" : "createdAt";
  const sinceStr = since.toISOString();
  try {
    await bq.query({
      query: `DELETE FROM \`${PROJECT_ID}.${DATASET_ID}.${tableName}\` WHERE ${dateCol} >= @since`,
      params: { since: sinceStr },
      parameterMode: "NAMED",
      location: "asia-southeast1"
    });
  } catch (err) {
    console.warn(`BigQuery delete from ${tableName} failed:`, err.message);
  }
}
function isBigQueryEnabled() {
  return !!bq && !!DATASET_ID;
}
function getDatasetId() {
  return DATASET_ID;
}
var import_bigquery, DATASET_ID, PROJECT_ID, bq, dataset, TABLE_SCHEMAS;
var init_bigquery = __esm({
  "src/lib/bigquery.ts"() {
    "use strict";
    import_bigquery = require("@google-cloud/bigquery");
    DATASET_ID = process.env.BIGQUERY_DATASET || "";
    PROJECT_ID = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "kengi-tech";
    bq = null;
    dataset = null;
    if (DATASET_ID) {
      try {
        bq = new import_bigquery.BigQuery({ projectId: PROJECT_ID });
        console.log(`\u2705 BigQuery enabled (dataset: ${DATASET_ID})`);
      } catch (err) {
        console.warn("\u26A0\uFE0F BigQuery init failed:", err.message);
      }
    } else {
      console.log("\u2139\uFE0F BIGQUERY_DATASET not set \u2014 analytics queries use Prisma (Cloud SQL)");
    }
    TABLE_SCHEMAS = {
      transactions: [
        { name: "id", type: "STRING", mode: "REQUIRED" },
        { name: "storeId", type: "STRING" },
        { name: "branchId", type: "STRING" },
        { name: "receiptNumber", type: "STRING" },
        { name: "customerId", type: "STRING" },
        { name: "customerName", type: "STRING" },
        { name: "total", type: "FLOAT" },
        { name: "subtotal", type: "FLOAT" },
        { name: "discount", type: "FLOAT" },
        { name: "tax", type: "FLOAT" },
        { name: "status", type: "STRING" },
        { name: "paymentMethod", type: "STRING" },
        { name: "createdAt", type: "TIMESTAMP" }
      ],
      transaction_items: [
        { name: "id", type: "STRING", mode: "REQUIRED" },
        { name: "transactionId", type: "STRING" },
        { name: "productId", type: "STRING" },
        { name: "productName", type: "STRING" },
        { name: "quantity", type: "INTEGER" },
        { name: "unitPrice", type: "FLOAT" },
        { name: "lineTotal", type: "FLOAT" },
        { name: "costPrice", type: "FLOAT" }
      ],
      expenses: [
        { name: "id", type: "STRING", mode: "REQUIRED" },
        { name: "storeId", type: "STRING" },
        { name: "category", type: "STRING" },
        { name: "amount", type: "FLOAT" },
        { name: "description", type: "STRING" },
        { name: "date", type: "TIMESTAMP" }
      ],
      products_snapshot: [
        { name: "id", type: "STRING", mode: "REQUIRED" },
        { name: "storeId", type: "STRING" },
        { name: "name", type: "STRING" },
        { name: "sku", type: "STRING" },
        { name: "costPrice", type: "FLOAT" },
        { name: "sellingPrice", type: "FLOAT" },
        { name: "stock", type: "INTEGER" },
        { name: "categoryId", type: "STRING" },
        { name: "snapshotDate", type: "DATE" }
      ],
      debt_entries: [
        { name: "id", type: "STRING", mode: "REQUIRED" },
        { name: "storeId", type: "STRING" },
        { name: "customerId", type: "STRING" },
        { name: "type", type: "STRING" },
        { name: "amount", type: "FLOAT" },
        { name: "createdAt", type: "TIMESTAMP" }
      ]
    };
  }
});

// src/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);
var import_express50 = __toESM(require("express"));
var import_cors = __toESM(require("cors"));
var import_helmet = __toESM(require("helmet"));
var import_express_rate_limit = __toESM(require("express-rate-limit"));

// src/lib/prisma.ts
var import_client = require("@prisma/client");
var import_store_client = __toESM(require_store_client());
var import_child_process = require("child_process");
var POOL_SIZE = parseInt(process.env.PRISMA_POOL_SIZE || "5", 10);
var POOL_TIMEOUT = parseInt(process.env.PRISMA_POOL_TIMEOUT || "10", 10);
var MAX_BRANCH_CLIENTS = parseInt(process.env.MAX_STORE_CLIENTS || "50", 10);
var registryPrisma = new import_client.PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL || "" } },
  log: process.env.NODE_ENV === "production" ? ["error", "warn"] : ["warn", "error"]
});
var branchClients = /* @__PURE__ */ new Map();
function getBaseDbUrl() {
  const url = process.env.DATABASE_URL || "";
  return url.replace(/[?&]schema=[^&]*/g, "").replace(/\?$/, "");
}
function branchIdToSchema(branchId) {
  const safe = branchId.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `branch_${safe}`;
}
function validateSchemaName(schemaName) {
  if (!/^[a-z0-9_]+$/.test(schemaName)) {
    throw new Error(`Invalid schema name: "${schemaName}" \u2014 only [a-z0-9_] allowed`);
  }
  if (schemaName.length > 63) {
    throw new Error(`Schema name too long: "${schemaName}" (max 63 chars)`);
  }
}
function getStorePrisma(schemaName) {
  validateSchemaName(schemaName);
  const existing = branchClients.get(schemaName);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.client;
  }
  if (branchClients.size >= MAX_BRANCH_CLIENTS) {
    let oldest = null;
    let oldestTime = Infinity;
    for (const [key, val] of branchClients) {
      if (val.lastUsed < oldestTime) {
        oldestTime = val.lastUsed;
        oldest = key;
      }
    }
    if (oldest) {
      branchClients.get(oldest)?.client.$disconnect().catch(() => {
      });
      branchClients.delete(oldest);
    }
  }
  const base = getBaseDbUrl();
  const sep = base.includes("?") ? "&" : "?";
  const url = `${base}${sep}schema=${schemaName}&connection_limit=${POOL_SIZE}&pool_timeout=${POOL_TIMEOUT}`;
  const client = new import_store_client.PrismaClient({
    datasources: { db: { url } },
    log: process.env.NODE_ENV === "production" ? ["error", "warn"] : ["warn", "error"]
  });
  branchClients.set(schemaName, { client, lastUsed: Date.now() });
  return client;
}
async function createBranchSchema(schemaName) {
  validateSchemaName(schemaName);
  await registryPrisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
  console.log(`\u{1F4E6} Schema created: ${schemaName}`);
  const base = getBaseDbUrl();
  const sep = base.includes("?") ? "&" : "?";
  const schemaUrl = `${base}${sep}schema=${schemaName}`;
  try {
    (0, import_child_process.execSync)("npx prisma db push --schema=prisma/schema-store.prisma --skip-generate --accept-data-loss", {
      stdio: "pipe",
      env: { ...process.env, STORE_DATABASE_URL: schemaUrl, DATABASE_URL: schemaUrl }
    });
    console.log(`\u2705 Tables pushed to schema: ${schemaName}`);
  } catch (err) {
    console.warn(`\u26A0\uFE0F prisma db push failed for ${schemaName}, attempting raw SQL fallback...`);
    await createTablesRawSQL(schemaName);
  }
}
async function createTablesRawSQL(schemaName) {
  validateSchemaName(schemaName);
  const q = (sql) => registryPrisma.$executeRawUnsafe(sql);
  await q(`CREATE TABLE IF NOT EXISTS "${schemaName}"."User" (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'cashier',
        phone TEXT,
        avatar TEXT,
        code TEXT UNIQUE,
        "branchId" TEXT,
        "employeeStatus" TEXT NOT NULL DEFAULT 'active',
        "isLocked" BOOLEAN NOT NULL DEFAULT false,
        "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
  await q(`CREATE TABLE IF NOT EXISTS "${schemaName}"."Branch" (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name TEXT NOT NULL,
        code TEXT UNIQUE NOT NULL,
        address TEXT,
        phone TEXT,
        "isMainBranch" BOOLEAN NOT NULL DEFAULT false,
        status TEXT NOT NULL DEFAULT 'active',
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
  await q(`CREATE TABLE IF NOT EXISTS "${schemaName}"."StoreSettings" (
        id TEXT PRIMARY KEY,
        name TEXT,
        address TEXT,
        phone TEXT,
        logo TEXT,
        currency TEXT NOT NULL DEFAULT 'VND',
        timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
  console.log(`\u2705 Core tables created via raw SQL in: ${schemaName}`);
}
async function dropBranchSchema(schemaName) {
  validateSchemaName(schemaName);
  await registryPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  branchClients.get(schemaName)?.client.$disconnect().catch(() => {
  });
  branchClients.delete(schemaName);
  console.log(`\u{1F5D1}\uFE0F Dropped schema: ${schemaName}`);
}
async function disconnectAll() {
  await registryPrisma.$disconnect();
  for (const [, { client }] of branchClients) {
    await client.$disconnect().catch(() => {
    });
  }
  branchClients.clear();
}
var dropStoreSchema = dropBranchSchema;

// src/routes/auth.ts
var import_express = require("express");
var import_bcryptjs2 = __toESM(require("bcryptjs"));
var import_jsonwebtoken2 = __toESM(require("jsonwebtoken"));

// src/middleware/auth.ts
var import_jsonwebtoken = __toESM(require("jsonwebtoken"));
var import_bcryptjs = __toESM(require("bcryptjs"));
var JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("\u274C JWT_SECRET environment variable is required. Set it in .env file.");
function resolveSchema(payload) {
  return payload.branchSchema || payload.storeSchema;
}
async function tryApiKeyAuth(req) {
  const apiKey = req.headers["x-api-key"];
  const schema = req.user ? resolveSchema(req.user) : void 0;
  if (!apiKey || !schema) return false;
  try {
    const storePrisma = getStorePrisma(schema);
    const keys = await storePrisma.apiKey.findMany({
      where: { isActive: true },
      include: { user: true }
    });
    for (const key of keys) {
      if (key.expiresAt && key.expiresAt < /* @__PURE__ */ new Date()) continue;
      const valid = await import_bcryptjs.default.compare(apiKey, key.secretHash);
      if (valid) {
        req.user = {
          userId: key.user.id,
          email: key.user.email,
          role: key.user.role,
          storeId: req.user?.storeId,
          storeCode: req.user?.storeCode,
          branchId: key.user.branchId || void 0,
          branchSchema: schema,
          storeSchema: schema
          // alias
        };
        req.storePrisma = storePrisma;
        storePrisma.apiKey.update({
          where: { id: key.id },
          data: { lastUsedAt: /* @__PURE__ */ new Date() }
        }).catch(() => {
        });
        return true;
      }
    }
  } catch {
  }
  return false;
}
var authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    try {
      const decoded = import_jsonwebtoken.default.verify(token, JWT_SECRET);
      req.user = decoded;
      const schema = resolveSchema(decoded);
      if (schema) {
        req.storePrisma = getStorePrisma(schema);
        if (decoded.storeId && decoded.role !== "superadmin") {
          const store = await registryPrisma.store.findUnique({
            where: { id: decoded.storeId },
            select: { status: true }
          });
          if (store && store.status === "suspended") {
            res.status(403).json({
              success: false,
              error: "C\u1EEDa h\xE0ng \u0111\xE3 b\u1ECB t\u1EA1m d\u1EEBng. Vui l\xF2ng li\xEAn h\u1EC7 qu\u1EA3n tr\u1ECB vi\xEAn h\u1EC7 th\u1ED1ng.",
              code: "STORE_SUSPENDED"
            });
            return;
          }
        }
      }
      next();
      return;
    } catch {
    }
  }
  const authenticated = await tryApiKeyAuth(req);
  if (authenticated) {
    next();
    return;
  }
  res.status(401).json({ success: false, error: "Access token required" });
};
function getBranchId(req) {
  return req.user?.branchId || void 0;
}
function getBranchFilter(req) {
  if (req.user?.isMainBranch) return {};
  return req.user?.branchId ? { branchId: req.user.branchId } : {};
}

// src/middleware/roleMiddleware.ts
function requireRole(...roles) {
  return (req, res, next) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    if (!roles.includes(user.role)) {
      return res.status(403).json({ success: false, error: "B\u1EA1n kh\xF4ng c\xF3 quy\u1EC1n th\u1EF1c hi\u1EC7n thao t\xE1c n\xE0y" });
    }
    next();
  };
}

// src/routes/auth.ts
var router = (0, import_express.Router)();
var JWT_SECRET2 = process.env.JWT_SECRET;
if (!JWT_SECRET2) throw new Error("\u274C JWT_SECRET environment variable is required.");
var JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
var USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  phone: true,
  avatar: true,
  code: true,
  employeeStatus: true,
  isLocked: true,
  twoFactorEnabled: true,
  branchId: true,
  createdAt: true
};
router.post("/signup", async (req, res) => {
  try {
    const { storeName, storeAddress, fullName, email, phone, password } = req.body;
    if (!storeName?.trim() || !fullName?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ success: false, error: "Vui l\xF2ng \u0111i\u1EC1n \u0111\u1EA7y \u0111\u1EE7 th\xF4ng tin" });
    }
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({ success: false, error: "M\u1EADt kh\u1EA9u t\u1ED1i thi\u1EC3u 8 k\xFD t\u1EF1, bao g\u1ED3m ch\u1EEF hoa v\xE0 s\u1ED1" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ success: false, error: "Email kh\xF4ng h\u1EE3p l\u1EC7" });
    }
    const code = storeName.trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").substring(0, 20);
    const existingStore = await registryPrisma.store.findUnique({ where: { code } });
    if (existingStore) {
      return res.status(409).json({ success: false, error: `C\u1EEDa h\xE0ng "${code}" \u0111\xE3 t\u1ED3n t\u1EA1i, vui l\xF2ng ch\u1ECDn t\xEAn kh\xE1c` });
    }
    const hashedPw = await import_bcryptjs2.default.hash(password, 10);
    const store = await registryPrisma.store.create({
      data: {
        code,
        name: storeName.trim(),
        address: storeAddress?.trim() || null,
        phone: phone?.trim() || null,
        schema: "pending"
        // will update after branch ID is known
      }
    });
    const tempSchema = branchIdToSchema(store.id);
    await createBranchSchema(tempSchema);
    const tempPrisma = getStorePrisma(tempSchema);
    const branch = await tempPrisma.branch.create({
      data: {
        name: "Chi nh\xE1nh ch\xEDnh",
        code: "CN01",
        isMainBranch: true,
        address: storeAddress?.trim() || null
      }
    });
    const finalSchema = branchIdToSchema(branch.id);
    await registryPrisma.$executeRawUnsafe(
      `ALTER SCHEMA "${tempSchema}" RENAME TO "${finalSchema}"`
    );
    await registryPrisma.store.update({
      where: { id: store.id },
      data: { schema: finalSchema }
    });
    const storePrisma = getStorePrisma(finalSchema);
    const user = await storePrisma.user.create({
      data: {
        email: email.trim().toLowerCase(),
        name: fullName.trim(),
        password: hashedPw,
        role: "admin",
        phone: phone?.trim() || null,
        branchId: branch.id
      }
    });
    await storePrisma.storeSettings.create({
      data: {
        id: "default",
        name: storeName.trim(),
        address: storeAddress?.trim() || null,
        phone: phone?.trim() || null
      }
    });
    console.log(`\u2705 [Signup] Store "${store.code}" \u2192 schema "${finalSchema}"`);
    const token = import_jsonwebtoken2.default.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        storeId: store.id,
        storeCode: store.code,
        branchId: branch.id,
        branchSchema: finalSchema,
        isMainBranch: true
      },
      JWT_SECRET2,
      { expiresIn: JWT_EXPIRES_IN }
    );
    res.status(201).json({
      success: true,
      data: {
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role, phone: user.phone },
        store: { id: store.id, code: store.code, name: store.name },
        branch: { id: branch.id, name: branch.name, code: branch.code, schema: finalSchema }
      }
    });
  } catch (err) {
    console.error("Signup error:", err?.message || err);
    res.status(500).json({ success: false, error: "L\u1ED7i h\u1EC7 th\u1ED1ng, vui l\xF2ng th\u1EED l\u1EA1i" });
  }
});
router.post("/branches", async (req, res) => {
  try {
    const { storeCode } = req.body;
    if (!storeCode) {
      res.status(400).json({ success: false, error: "storeCode required" });
      return;
    }
    const store = await registryPrisma.store.findFirst({ where: { code: storeCode } });
    if (!store || store.status !== "active") {
      res.status(404).json({ success: false, error: "M\xE3 c\u1EEDa h\xE0ng kh\xF4ng t\u1ED3n t\u1EA1i" });
      return;
    }
    const mainPrisma = getStorePrisma(store.schema);
    const branches = await mainPrisma.branch.findMany({
      where: { status: "active" },
      select: { id: true, name: true, code: true, address: true, phone: true, isMainBranch: true },
      orderBy: [{ isMainBranch: "desc" }, { name: "asc" }]
    });
    res.json({
      success: true,
      data: {
        store: { id: store.id, name: store.name, logo: null },
        branches
      }
    });
  } catch (err) {
    console.error("Get branches error:", err);
    res.status(500).json({ success: false, error: "Internal server error", detail: err?.message || String(err) });
  }
});
router.post("/login", async (req, res) => {
  try {
    const { email, password, storeCode, branchId } = req.body;
    if (!email || !password) {
      res.status(400).json({ success: false, error: "Email v\xE0 m\u1EADt kh\u1EA9u l\xE0 b\u1EAFt bu\u1ED9c" });
      return;
    }
    if (!storeCode) {
      res.status(400).json({ success: false, error: "M\xE3 c\u1EEDa h\xE0ng l\xE0 b\u1EAFt bu\u1ED9c" });
      return;
    }
    const store = await registryPrisma.store.findFirst({ where: { code: storeCode } });
    if (!store) {
      res.status(401).json({ success: false, error: "M\xE3 c\u1EEDa h\xE0ng kh\xF4ng t\u1ED3n t\u1EA1i" });
      return;
    }
    if (store.status !== "active") {
      res.status(401).json({ success: false, error: "C\u1EEDa h\xE0ng \u0111\xE3 b\u1ECB v\xF4 hi\u1EC7u h\xF3a" });
      return;
    }
    const branchSchema = store.schema;
    const targetBranchId = branchId || null;
    const branchPrisma = getStorePrisma(branchSchema);
    const user = await branchPrisma.user.findFirst({
      where: { email: email.trim().toLowerCase() }
    });
    if (!user) {
      res.status(401).json({ success: false, error: "Email ho\u1EB7c m\u1EADt kh\u1EA9u kh\xF4ng \u0111\xFAng" });
      return;
    }
    if (user.isLocked) {
      res.status(403).json({ success: false, error: "T\xE0i kho\u1EA3n \u0111\xE3 b\u1ECB kh\xF3a. Li\xEAn h\u1EC7 qu\u1EA3n tr\u1ECB vi\xEAn." });
      return;
    }
    const valid = await import_bcryptjs2.default.compare(password, user.password);
    if (!valid) {
      res.status(401).json({ success: false, error: "Email ho\u1EB7c m\u1EADt kh\u1EA9u kh\xF4ng \u0111\xFAng" });
      return;
    }
    const effectiveBranchId = targetBranchId || user.branchId;
    let branch = null;
    if (effectiveBranchId) {
      branch = await branchPrisma.branch.findUnique({
        where: { id: effectiveBranchId },
        select: { id: true, name: true, code: true, address: true, isMainBranch: true }
      });
    }
    const settings = await branchPrisma.storeSettings.findUnique({ where: { id: "default" } });
    const token = import_jsonwebtoken2.default.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        storeId: store.id,
        storeCode: store.code,
        branchId: effectiveBranchId,
        branchSchema,
        storeSchema: branchSchema,
        // legacy alias
        isMainBranch: branch?.isMainBranch || false
      },
      JWT_SECRET2,
      { expiresIn: JWT_EXPIRES_IN }
    );
    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          phone: user.phone,
          avatar: user.avatar,
          twoFactorEnabled: user.twoFactorEnabled
        },
        store: {
          id: store.id,
          code: store.code,
          name: store.name,
          address: settings?.address || store.address,
          phone: settings?.phone || store.phone,
          logo: settings?.logo || null
        },
        branch
      }
    });
  } catch (err) {
    console.error("Login error:", err?.message || err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router.post("/add-branch", authMiddleware, async (req, res) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ success: false, error: "Ch\u1EC9 admin m\u1EDBi c\xF3 th\u1EC3 th\xEAm chi nh\xE1nh" });
    }
    const storePrisma = req.storePrisma;
    const { name, code, address, phone } = req.body;
    if (!name?.trim() || !code?.trim()) {
      return res.status(400).json({ success: false, error: "T\xEAn v\xE0 m\xE3 chi nh\xE1nh l\xE0 b\u1EAFt bu\u1ED9c" });
    }
    const existing = await storePrisma.branch.findFirst({ where: { code } });
    if (existing) return res.status(409).json({ success: false, error: `M\xE3 chi nh\xE1nh "${code}" \u0111\xE3 t\u1ED3n t\u1EA1i` });
    const branch = await storePrisma.branch.create({
      data: { name: name.trim(), code: code.trim(), address: address || null, phone: phone || null }
    });
    const newSchema = branchIdToSchema(branch.id);
    await createBranchSchema(newSchema);
    const newPrisma = getStorePrisma(newSchema);
    const storeSettings = await storePrisma.storeSettings.findUnique({ where: { id: "default" } });
    await newPrisma.branch.create({
      data: { id: branch.id, name: branch.name, code: branch.code, address: branch.address, phone: branch.phone }
    });
    if (storeSettings) {
      await newPrisma.storeSettings.create({ data: { ...storeSettings } });
    }
    console.log(`\u2705 [AddBranch] Branch "${name}" (${code}) \u2192 schema "${newSchema}"`);
    res.status(201).json({
      success: true,
      data: {
        branch: { ...branch, schema: newSchema },
        message: `Chi nh\xE1nh "${name}" \u0111\xE3 \u0111\u01B0\u1EE3c t\u1EA1o v\u1EDBi schema ri\xEAng`
      }
    });
  } catch (err) {
    console.error("Add branch error:", err?.message || err);
    res.status(500).json({ success: false, error: "L\u1ED7i khi t\u1EA1o chi nh\xE1nh" });
  }
});
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const storePrisma = req.storePrisma;
    const user = await storePrisma.user.findUnique({ where: { id: req.user.userId }, select: USER_SELECT });
    if (!user) {
      res.status(404).json({ success: false, error: "User not found" });
      return;
    }
    let store = null;
    if (req.user?.storeId) {
      store = await registryPrisma.store.findUnique({
        where: { id: req.user.storeId },
        select: { id: true, code: true, name: true, address: true, phone: true }
      });
    }
    let branch = null;
    if (user.branchId) {
      branch = await storePrisma.branch.findUnique({
        where: { id: user.branchId },
        select: { id: true, name: true, code: true, address: true }
      });
    }
    const settings = await storePrisma.storeSettings.findUnique({ where: { id: "default" } });
    res.json({
      success: true,
      data: {
        ...user,
        storeId: req.user?.storeId,
        storeCode: req.user?.storeCode,
        branchSchema: req.user?.branchSchema,
        store: store ? { ...store, logo: settings?.logo, address: settings?.address || store.address, phone: settings?.phone || store.phone } : null,
        branch
      }
    });
  } catch (err) {
    console.error("Get me error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router.get("/users", authMiddleware, requireRole("admin", "manager"), async (req, res) => {
  try {
    const storePrisma = req.storePrisma;
    const users = await storePrisma.user.findMany({
      select: { ...USER_SELECT, salary: true, hireDate: true, notes: true },
      orderBy: { name: "asc" }
    });
    res.json({ success: true, data: users });
  } catch (err) {
    console.error("List users error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router.post("/register", authMiddleware, requireRole("admin", "manager"), async (req, res) => {
  try {
    const storePrisma = req.storePrisma;
    const { email, name, password, role, phone, code, branchId } = req.body;
    if (!email?.trim() || !name?.trim() || !password) {
      res.status(400).json({ success: false, error: "Email, t\xEAn v\xE0 m\u1EADt kh\u1EA9u l\xE0 b\u1EAFt bu\u1ED9c" });
      return;
    }
    const hashed = await import_bcryptjs2.default.hash(password, 10);
    const user = await storePrisma.user.create({
      data: {
        email: email.trim().toLowerCase(),
        name: name.trim(),
        password: hashed,
        role: role || "cashier",
        phone,
        code,
        branchId
      },
      select: USER_SELECT
    });
    res.status(201).json({ success: true, data: user });
  } catch (err) {
    if (err?.code === "P2002") {
      res.status(409).json({ success: false, error: "Email ho\u1EB7c m\xE3 nh\xE2n vi\xEAn \u0111\xE3 t\u1ED3n t\u1EA1i" });
      return;
    }
    console.error("Register error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router.put("/users/:id", authMiddleware, requireRole("admin"), async (req, res) => {
  try {
    const storePrisma = req.storePrisma;
    const { name, email, phone, role, code, branchId, isLocked, employeeStatus, password } = req.body;
    const data = {};
    if (name !== void 0) data.name = name.trim();
    if (email !== void 0) data.email = email.trim().toLowerCase();
    if (phone !== void 0) data.phone = phone;
    if (role !== void 0) data.role = role;
    if (code !== void 0) data.code = code;
    if (branchId !== void 0) data.branchId = branchId || null;
    if (isLocked !== void 0) data.isLocked = Boolean(isLocked);
    if (employeeStatus !== void 0) data.employeeStatus = employeeStatus;
    if (password) data.password = await import_bcryptjs2.default.hash(password, 10);
    const user = await storePrisma.user.update({ where: { id: String(req.params.id) }, data, select: USER_SELECT });
    res.json({ success: true, data: user });
  } catch (err) {
    console.error("Update user error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router.delete("/users/:id", authMiddleware, requireRole("admin"), async (req, res) => {
  try {
    const storePrisma = req.storePrisma;
    await storePrisma.user.update({ where: { id: String(req.params.id) }, data: { employeeStatus: "inactive", isLocked: true } });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete user error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router.put("/change-password", authMiddleware, async (req, res) => {
  try {
    const storePrisma = req.storePrisma;
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      res.status(400).json({ success: false, error: "M\u1EADt kh\u1EA9u c\u0169 v\xE0 m\u1EDBi l\xE0 b\u1EAFt bu\u1ED9c" });
      return;
    }
    if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      res.status(400).json({ success: false, error: "M\u1EADt kh\u1EA9u m\u1EDBi ph\u1EA3i c\xF3 \xEDt nh\u1EA5t 8 k\xFD t\u1EF1, bao g\u1ED3m ch\u1EEF hoa v\xE0 s\u1ED1" });
      return;
    }
    const user = await storePrisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) {
      res.status(404).json({ success: false, error: "User not found" });
      return;
    }
    const valid = await import_bcryptjs2.default.compare(oldPassword, user.password);
    if (!valid) {
      res.status(400).json({ success: false, error: "M\u1EADt kh\u1EA9u c\u0169 kh\xF4ng \u0111\xFAng" });
      return;
    }
    await storePrisma.user.update({ where: { id: user.id }, data: { password: await import_bcryptjs2.default.hash(newPassword, 10) } });
    res.json({ success: true, message: "\u0110\u1ED5i m\u1EADt kh\u1EA9u th\xE0nh c\xF4ng" });
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router.put("/update-email", authMiddleware, async (req, res) => {
  try {
    const storePrisma = req.storePrisma;
    const { newEmail } = req.body;
    if (!newEmail?.trim()) {
      res.status(400).json({ success: false, error: "Email m\u1EDBi l\xE0 b\u1EAFt bu\u1ED9c" });
      return;
    }
    await storePrisma.user.update({ where: { id: req.user.userId }, data: { email: newEmail.trim().toLowerCase() } });
    res.json({ success: true, message: "C\u1EADp nh\u1EADt email th\xE0nh c\xF4ng" });
  } catch (err) {
    console.error("Update email error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router.put("/toggle-2fa", authMiddleware, async (req, res) => {
  try {
    const storePrisma = req.storePrisma;
    const user = await storePrisma.user.findUnique({ where: { id: req.user.userId }, select: { twoFactorEnabled: true } });
    if (!user) {
      res.status(404).json({ success: false, error: "User not found" });
      return;
    }
    const newVal = !user.twoFactorEnabled;
    await storePrisma.user.update({ where: { id: req.user.userId }, data: { twoFactorEnabled: newVal } });
    res.json({ success: true, data: { twoFactorEnabled: newVal } });
  } catch (err) {
    console.error("Toggle 2FA error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var auth_default = router;

// src/routes/products.ts
var import_express2 = require("express");

// src/lib/cache.ts
var import_ioredis = __toESM(require("ioredis"));
var REDIS_URL = process.env.REDIS_URL || "";
var redis = null;
var memoryCache = /* @__PURE__ */ new Map();
var useMemory = false;
function initRedis() {
  if (!REDIS_URL) {
    console.log("\u26A1 Redis URL not set \u2014 using in-memory cache");
    useMemory = true;
    return null;
  }
  try {
    const client = new import_ioredis.default(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) {
          console.warn("\u26A0\uFE0F Redis connection failed \u2014 falling back to in-memory cache");
          useMemory = true;
          return null;
        }
        return Math.min(times * 200, 2e3);
      },
      lazyConnect: true
    });
    client.on("error", (err) => {
      if (!useMemory) {
        console.warn("\u26A0\uFE0F Redis error, falling back to memory:", err.message);
        useMemory = true;
      }
    });
    client.on("connect", () => {
      console.log("\u2705 Redis connected");
      useMemory = false;
    });
    client.connect().catch(() => {
      useMemory = true;
    });
    return client;
  } catch {
    useMemory = true;
    return null;
  }
}
redis = initRedis();
function memGet(key) {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}
function memSet(key, value, ttlMs) {
  if (memoryCache.size > 1e3) {
    const first = memoryCache.keys().next().value;
    if (first) memoryCache.delete(first);
  }
  memoryCache.set(key, { value, expiresAt: ttlMs > 0 ? Date.now() + ttlMs : 0 });
}
function memDel(pattern) {
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    for (const key of memoryCache.keys()) {
      if (key.startsWith(prefix)) memoryCache.delete(key);
    }
  } else {
    memoryCache.delete(pattern);
  }
}
async function cacheGet(key) {
  try {
    if (useMemory || !redis) {
      const raw3 = memGet(key);
      return raw3 ? JSON.parse(raw3) : null;
    }
    const raw2 = await redis.get(key);
    return raw2 ? JSON.parse(raw2) : null;
  } catch {
    return null;
  }
}
async function cacheSet(key, value, ttlSeconds = 60) {
  try {
    const json = JSON.stringify(value);
    if (useMemory || !redis) {
      memSet(key, json, ttlSeconds * 1e3);
      return;
    }
    if (ttlSeconds > 0) {
      await redis.set(key, json, "EX", ttlSeconds);
    } else {
      await redis.set(key, json);
    }
  } catch {
  }
}
async function cacheDel(pattern) {
  try {
    if (useMemory || !redis) {
      memDel(pattern);
      return;
    }
    if (pattern.endsWith("*")) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } else {
      await redis.del(pattern);
    }
  } catch {
  }
}
async function cacheDisconnect() {
  if (redis) {
    await redis.quit().catch(() => {
    });
  }
  memoryCache.clear();
}
async function cacheHealth() {
  if (useMemory || !redis) {
    return { status: "ok", type: "memory" };
  }
  try {
    await redis.ping();
    return { status: "ok", type: "redis" };
  } catch {
    return { status: "degraded", type: "memory-fallback" };
  }
}

// src/middleware/validate.ts
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.errors.map((e) => ({
        field: e.path.join("."),
        message: e.message
      }));
      return res.status(400).json({ success: false, error: "Validation failed", errors });
    }
    req.body = result.data;
    next();
  };
}

// src/schemas/index.ts
var import_zod = require("zod");
var CreateProductSchema = import_zod.z.object({
  name: import_zod.z.string().min(1, "T\xEAn s\u1EA3n ph\u1EA9m kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng").max(255),
  sku: import_zod.z.string().min(1, "SKU kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng").max(100),
  barcode: import_zod.z.string().max(100).optional().nullable(),
  description: import_zod.z.string().max(2e3).optional().nullable(),
  categoryId: import_zod.z.string().optional().nullable(),
  brandId: import_zod.z.string().optional().nullable(),
  supplierId: import_zod.z.string().optional().nullable(),
  costPrice: import_zod.z.number().min(0, "Gi\xE1 v\u1ED1n kh\xF4ng \u0111\u01B0\u1EE3c \xE2m"),
  sellingPrice: import_zod.z.number().min(0, "Gi\xE1 b\xE1n kh\xF4ng \u0111\u01B0\u1EE3c \xE2m"),
  stock: import_zod.z.number().int().min(0).default(0),
  unit: import_zod.z.string().max(50).optional().nullable(),
  weight: import_zod.z.number().min(0).optional().nullable(),
  productType: import_zod.z.enum(["product", "service", "combo"]).default("product"),
  status: import_zod.z.enum(["active", "inactive", "draft"]).default("active"),
  tags: import_zod.z.array(import_zod.z.string()).optional().default([])
});
var UpdateProductSchema = CreateProductSchema.partial();
var CreateTransactionSchema = import_zod.z.object({
  customerId: import_zod.z.string().optional().nullable(),
  customerName: import_zod.z.string().max(200).optional().nullable(),
  customerPhone: import_zod.z.string().max(20).optional().nullable(),
  items: import_zod.z.array(import_zod.z.object({
    productId: import_zod.z.string().min(1),
    productName: import_zod.z.string().min(1),
    sku: import_zod.z.string().optional(),
    quantity: import_zod.z.number().int().min(1),
    unitPrice: import_zod.z.number().min(0),
    discount: import_zod.z.number().min(0).default(0),
    lineTotal: import_zod.z.number().min(0)
  })).min(1, "\u0110\u01A1n h\xE0ng ph\u1EA3i c\xF3 \xEDt nh\u1EA5t 1 s\u1EA3n ph\u1EA9m"),
  payments: import_zod.z.array(import_zod.z.object({
    type: import_zod.z.enum(["cash", "card", "transfer", "ewallet", "credit"]),
    amount: import_zod.z.number().min(0),
    reference: import_zod.z.string().optional().nullable()
  })).min(1, "Ph\u01B0\u01A1ng th\u1EE9c thanh to\xE1n kh\xF4ng h\u1EE3p l\u1EC7"),
  subtotal: import_zod.z.number().min(0),
  discount: import_zod.z.number().min(0).default(0),
  tax: import_zod.z.number().min(0).default(0),
  total: import_zod.z.number().min(0),
  amountReceived: import_zod.z.number().min(0).optional().nullable(),
  change: import_zod.z.number().min(0).optional().nullable(),
  debtAmount: import_zod.z.number().min(0).optional().nullable(),
  notes: import_zod.z.string().max(500).optional().nullable(),
  status: import_zod.z.enum(["completed", "partial", "voided"]).default("completed")
});
var CreateCustomerSchema = import_zod.z.object({
  name: import_zod.z.string().min(1, "T\xEAn kh\xE1ch h\xE0ng kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng").max(200),
  phone: import_zod.z.string().max(20).optional().nullable(),
  email: import_zod.z.string().email().optional().nullable().or(import_zod.z.literal("")),
  address: import_zod.z.string().max(500).optional().nullable(),
  groupId: import_zod.z.string().optional().nullable(),
  taxCode: import_zod.z.string().max(20).optional().nullable(),
  note: import_zod.z.string().max(1e3).optional().nullable(),
  debt: import_zod.z.number().min(0).default(0),
  loyaltyPoints: import_zod.z.number().int().min(0).default(0)
});
var UpdateCustomerSchema = CreateCustomerSchema.partial();
var CreateEmployeeSchema = import_zod.z.object({
  name: import_zod.z.string().min(1, "T\xEAn nh\xE2n vi\xEAn kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng").max(200),
  email: import_zod.z.string().email("Email kh\xF4ng h\u1EE3p l\u1EC7").optional().nullable().or(import_zod.z.literal("")),
  phone: import_zod.z.string().max(20).optional().nullable(),
  role: import_zod.z.enum(["admin", "manager", "staff", "cashier", "warehouse", "driver", "accountant"]).optional(),
  department: import_zod.z.string().max(100).optional().nullable(),
  position: import_zod.z.string().max(100).optional().nullable(),
  salary: import_zod.z.number().min(0).optional().nullable(),
  startDate: import_zod.z.string().optional().nullable(),
  status: import_zod.z.enum(["active", "inactive"]).default("active"),
  address: import_zod.z.string().max(500).optional().nullable(),
  note: import_zod.z.string().max(1e3).optional().nullable()
});
var UpdateEmployeeSchema = CreateEmployeeSchema.partial();
var CreateBrandSchema = import_zod.z.object({
  name: import_zod.z.string().min(1, "T\xEAn th\u01B0\u01A1ng hi\u1EC7u kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng").max(200),
  description: import_zod.z.string().max(1e3).optional().nullable()
});
var UpdateBrandSchema = CreateBrandSchema.partial();
var CreateSupplierSchema = import_zod.z.object({
  name: import_zod.z.string().min(1, "T\xEAn nh\xE0 cung c\u1EA5p kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng").max(200),
  code: import_zod.z.string().max(50).optional().nullable(),
  phone: import_zod.z.string().max(20).optional().nullable(),
  email: import_zod.z.string().email().optional().nullable().or(import_zod.z.literal("")),
  address: import_zod.z.string().max(500).optional().nullable(),
  taxCode: import_zod.z.string().max(20).optional().nullable(),
  contactPerson: import_zod.z.string().max(200).optional().nullable(),
  paymentTerms: import_zod.z.string().max(200).optional().nullable(),
  note: import_zod.z.string().max(1e3).optional().nullable(),
  status: import_zod.z.enum(["active", "inactive"]).default("active")
});
var UpdateSupplierSchema = CreateSupplierSchema.partial();
var CreateCategorySchema = import_zod.z.object({
  name: import_zod.z.string().min(1, "T\xEAn danh m\u1EE5c kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng").max(200),
  description: import_zod.z.string().max(1e3).optional().nullable(),
  parentId: import_zod.z.string().optional().nullable(),
  image: import_zod.z.string().url().optional().nullable(),
  displayOrder: import_zod.z.number().int().min(0).optional()
});
var UpdateCategorySchema = CreateCategorySchema.partial();
var CreateRepairSchema = import_zod.z.object({
  productName: import_zod.z.string().min(1, "T\xEAn thi\u1EBFt b\u1ECB kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng").max(200),
  customerName: import_zod.z.string().max(200).optional().nullable(),
  customerPhone: import_zod.z.string().max(20).optional().nullable(),
  issue: import_zod.z.string().min(1, "M\xF4 t\u1EA3 s\u1EF1 c\u1ED1 kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng").max(1e3),
  cost: import_zod.z.number().min(0).optional().nullable(),
  estimatedDate: import_zod.z.string().optional().nullable(),
  notes: import_zod.z.string().max(1e3).optional().nullable(),
  status: import_zod.z.enum(["pending", "in_progress", "done", "cancelled"]).default("pending")
});
var UpdateRepairSchema = CreateRepairSchema.partial();
var CreateWarrantySchema = import_zod.z.object({
  productName: import_zod.z.string().min(1, "T\xEAn s\u1EA3n ph\u1EA9m kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng").max(200),
  customerName: import_zod.z.string().min(1, "T\xEAn kh\xE1ch h\xE0ng kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng").max(200),
  customerPhone: import_zod.z.string().max(20).optional().nullable(),
  serialNumber: import_zod.z.string().max(100).optional().nullable(),
  startDate: import_zod.z.string().min(1, "Ng\xE0y b\u1EAFt \u0111\u1EA7u b\u1EA3o h\xE0nh kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng"),
  endDate: import_zod.z.string().min(1, "Ng\xE0y k\u1EBFt th\xFAc b\u1EA3o h\xE0nh kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng"),
  notes: import_zod.z.string().max(1e3).optional().nullable(),
  productId: import_zod.z.string().optional().nullable(),
  status: import_zod.z.enum(["active", "expired", "claimed", "void"]).default("active")
});
var UpdateWarrantySchema = CreateWarrantySchema.partial();
var CreateQuotationSchema = import_zod.z.object({
  customerName: import_zod.z.string().max(200).optional().nullable(),
  customerPhone: import_zod.z.string().max(20).optional().nullable(),
  customerId: import_zod.z.string().optional().nullable(),
  items: import_zod.z.array(import_zod.z.object({
    productId: import_zod.z.string().min(1),
    productName: import_zod.z.string().min(1),
    quantity: import_zod.z.number().int().min(1),
    unitPrice: import_zod.z.number().min(0),
    discount: import_zod.z.number().min(0).default(0)
  })).min(1, "B\xE1o gi\xE1 ph\u1EA3i c\xF3 \xEDt nh\u1EA5t 1 s\u1EA3n ph\u1EA9m"),
  total: import_zod.z.number().min(0),
  validUntil: import_zod.z.string().optional().nullable(),
  notes: import_zod.z.string().max(1e3).optional().nullable(),
  status: import_zod.z.enum(["draft", "sent", "accepted", "rejected", "expired"]).default("draft")
});
var UpdateQuotationSchema = CreateQuotationSchema.partial();
var CreateBundleSchema = import_zod.z.object({
  name: import_zod.z.string().min(1, "T\xEAn combo kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng").max(200),
  description: import_zod.z.string().max(1e3).optional().nullable(),
  price: import_zod.z.number().min(0, "Gi\xE1 combo kh\xF4ng \u0111\u01B0\u1EE3c \xE2m"),
  discountType: import_zod.z.enum(["fixed", "percent"]).default("fixed"),
  discountValue: import_zod.z.number().min(0).default(0),
  startDate: import_zod.z.string().optional().nullable(),
  endDate: import_zod.z.string().optional().nullable(),
  status: import_zod.z.enum(["active", "inactive"]).default("active"),
  items: import_zod.z.array(import_zod.z.object({
    productId: import_zod.z.string().min(1),
    quantity: import_zod.z.number().int().min(1)
  })).min(1, "Combo ph\u1EA3i c\xF3 \xEDt nh\u1EA5t 1 s\u1EA3n ph\u1EA9m")
});
var UpdateBundleSchema = CreateBundleSchema.partial();
var CreateScheduleSchema = import_zod.z.object({
  employeeId: import_zod.z.string().min(1, "Nh\xE2n vi\xEAn kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng"),
  date: import_zod.z.string().min(1, "Ng\xE0y kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng"),
  shiftType: import_zod.z.enum(["morning", "afternoon", "evening", "full", "custom"]).default("morning"),
  startTime: import_zod.z.string().optional().nullable(),
  endTime: import_zod.z.string().optional().nullable(),
  note: import_zod.z.string().max(500).optional().nullable(),
  status: import_zod.z.enum(["scheduled", "confirmed", "absent", "late"]).default("scheduled")
});
var UpdateScheduleSchema = CreateScheduleSchema.partial();
var CreateExpenseSchema = import_zod.z.object({
  description: import_zod.z.string().min(1, "M\xF4 t\u1EA3 kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng").max(500),
  amount: import_zod.z.number().positive("S\u1ED1 ti\u1EC1n ph\u1EA3i l\u1EDBn h\u01A1n 0"),
  category: import_zod.z.string().max(100).default("other"),
  paidBy: import_zod.z.string().max(200).default("Admin"),
  recurring: import_zod.z.boolean().default(false),
  date: import_zod.z.string().optional().nullable()
});
var UpdateExpenseSchema = CreateExpenseSchema.partial();
var CreatePromotionSchema = import_zod.z.object({
  name: import_zod.z.string().min(1, "T\xEAn ch\u01B0\u01A1ng tr\xECnh kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng").max(200),
  code: import_zod.z.string().max(50).optional().nullable(),
  type: import_zod.z.enum(["percentage", "fixed", "bogo", "freebie"]).default("percentage"),
  value: import_zod.z.number().min(0).default(0),
  minOrderValue: import_zod.z.number().min(0).default(0),
  maxDiscount: import_zod.z.number().min(0).optional().nullable(),
  startDate: import_zod.z.string().min(1, "Ng\xE0y b\u1EAFt \u0111\u1EA7u kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng"),
  endDate: import_zod.z.string().min(1, "Ng\xE0y k\u1EBFt th\xFAc kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng"),
  status: import_zod.z.enum(["active", "scheduled", "paused", "expired"]).default("active"),
  categoryIds: import_zod.z.array(import_zod.z.string()).optional().nullable(),
  productIds: import_zod.z.array(import_zod.z.string()).optional().nullable(),
  applicableTo: import_zod.z.enum(["all", "category", "product"]).default("all"),
  usageLimit: import_zod.z.number().int().min(0).optional().nullable()
});
var UpdatePromotionSchema = CreatePromotionSchema.partial();
var CreatePriceListSchema = import_zod.z.object({
  name: import_zod.z.string().min(1, "T\xEAn b\u1EA3ng gi\xE1 kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng").max(200),
  description: import_zod.z.string().max(500).optional().nullable(),
  currency: import_zod.z.string().max(10).default("VND"),
  isDefault: import_zod.z.boolean().default(false),
  active: import_zod.z.boolean().default(true)
});
var UpdatePriceListSchema = CreatePriceListSchema.partial();
var CreatePriceRuleSchema = import_zod.z.object({
  name: import_zod.z.string().min(1, "T\xEAn quy t\u1EAFc kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng").max(200),
  type: import_zod.z.enum(["markup", "discount", "fixed", "override"]).default("discount"),
  value: import_zod.z.number().min(0),
  scope: import_zod.z.enum(["all", "category", "product"]).default("all"),
  scopeIds: import_zod.z.array(import_zod.z.string()).optional().nullable(),
  appliesTo: import_zod.z.enum(["sellingPrice", "costPrice"]).default("sellingPrice"),
  priority: import_zod.z.number().int().min(1).default(1),
  startDate: import_zod.z.string().optional().nullable(),
  endDate: import_zod.z.string().optional().nullable(),
  active: import_zod.z.boolean().default(true),
  customerGroup: import_zod.z.string().max(100).optional().nullable(),
  minQty: import_zod.z.number().int().min(0).optional().nullable(),
  note: import_zod.z.string().max(500).optional().nullable()
});
var UpdatePriceRuleSchema = CreatePriceRuleSchema.partial();
var CreateLoyaltyMemberSchema = import_zod.z.object({
  name: import_zod.z.string().min(1, "T\xEAn th\xE0nh vi\xEAn kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng").max(200),
  phone: import_zod.z.string().max(20).optional().nullable(),
  customerId: import_zod.z.string().optional().nullable(),
  tier: import_zod.z.enum(["bronze", "silver", "gold", "diamond"]).default("bronze")
});
var UpdateLoyaltyMemberSchema = CreateLoyaltyMemberSchema.partial();
var LoyaltyPointsSchema = import_zod.z.object({
  action: import_zod.z.enum(["earn", "redeem", "bonus", "expire"]),
  amount: import_zod.z.number().positive("S\u1ED1 \u0111i\u1EC3m ph\u1EA3i l\u1EDBn h\u01A1n 0"),
  description: import_zod.z.string().max(500).optional().nullable()
});
var CreateReturnSchema = import_zod.z.object({
  code: import_zod.z.string().max(50).optional().nullable(),
  originalInvoice: import_zod.z.string().min(1, "H\xF3a \u0111\u01A1n g\u1ED1c kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng").max(200),
  transactionId: import_zod.z.string().optional().nullable(),
  customerName: import_zod.z.string().min(1, "T\xEAn kh\xE1ch h\xE0ng kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng").max(200),
  customerPhone: import_zod.z.string().max(20).optional().nullable(),
  reason: import_zod.z.string().min(1, "L\xFD do tr\u1EA3 h\xE0ng kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng").max(500),
  refundMethod: import_zod.z.string().max(50).optional().nullable(),
  staffName: import_zod.z.string().max(200).optional().nullable(),
  items: import_zod.z.array(import_zod.z.object({
    productId: import_zod.z.string().optional().nullable(),
    productName: import_zod.z.string().min(1),
    sku: import_zod.z.string().optional().nullable(),
    quantity: import_zod.z.number().int().min(1),
    unitPrice: import_zod.z.number().min(0),
    condition: import_zod.z.string().optional().nullable(),
    returnReason: import_zod.z.string().optional().nullable()
  })).min(1, "Ph\u1EA3i c\xF3 \xEDt nh\u1EA5t 1 s\u1EA3n ph\u1EA9m"),
  totalRefund: import_zod.z.number().min(0).default(0),
  notes: import_zod.z.string().max(1e3).optional().nullable()
});
var UpdateReturnSchema = CreateReturnSchema.partial();
var CreateAnnouncementSchema = import_zod.z.object({
  title: import_zod.z.string().min(1, "Ti\xEAu \u0111\u1EC1 kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng").max(300),
  content: import_zod.z.string().min(1, "N\u1ED9i dung kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng").max(5e3),
  priority: import_zod.z.enum(["info", "warning", "urgent"]).default("info"),
  author: import_zod.z.string().max(200).optional().nullable(),
  pinned: import_zod.z.boolean().default(false)
});
var UpdateAnnouncementSchema = CreateAnnouncementSchema.partial();

// src/routes/products.ts
var router2 = (0, import_express2.Router)();
router2.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const cacheKey = `products:${req.user?.storeSchema || "default"}:${JSON.stringify(req.query)}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return res.json(cached);
    const {
      search,
      categoryId,
      brandId,
      stockStatus,
      productType,
      page = "1",
      pageSize = "20",
      sortBy = "createdAt",
      sortOrder = "desc"
    } = req.query;
    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
        { barcode: { contains: search, mode: "insensitive" } }
      ];
    }
    if (categoryId) where.categoryId = categoryId;
    if (brandId) where.brandId = brandId;
    if (productType) where.productType = productType;
    if (stockStatus === "in_stock") where.stock = { gt: 0 };
    if (stockStatus === "out_of_stock") where.stock = 0;
    const pageNum = Math.max(1, parseInt(page));
    const size = Math.max(1, Math.min(100, parseInt(pageSize)));
    const skip2 = (pageNum - 1) * size;
    const [total, products] = await Promise.all([
      prisma2.product.count({ where }),
      prisma2.product.findMany({
        where,
        include: {
          category: true,
          brand: true,
          images: true,
          unitConversions: true
        },
        orderBy: { [sortBy]: sortOrder },
        skip: skip2,
        take: size
      })
    ]);
    let filteredProducts = products;
    let filteredTotal = total;
    if (stockStatus === "low_stock") {
      filteredProducts = products.filter((p) => p.stock > 0 && p.stock <= p.minStock);
      filteredTotal = filteredProducts.length;
    }
    const data = filteredProducts.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      description: p.description,
      productType: p.productType || "goods",
      categoryId: p.categoryId,
      categoryName: p.category?.name || "",
      brandId: p.brandId,
      brandName: p.brand?.name || "",
      costPrice: p.costPrice,
      sellingPrice: p.sellingPrice,
      taxInclusive: p.taxInclusive,
      stock: p.stock,
      minStock: p.minStock,
      maxStock: p.maxStock,
      baseUnit: p.baseUnit,
      trackSerial: p.trackSerial,
      images: (p.images || []).map((img) => ({ id: img.id, url: img.url, isPrimary: img.isPrimary })),
      unitConversions: p.unitConversions || [],
      createdAt: p.createdAt?.toISOString?.() || p.createdAt,
      updatedAt: p.updatedAt?.toISOString?.() || p.updatedAt
    }));
    const response = {
      success: true,
      data: {
        items: data,
        total: filteredTotal,
        page: pageNum,
        pageSize: size,
        totalPages: Math.ceil(filteredTotal / size)
      }
    };
    await cacheSet(cacheKey, response, 60);
    res.json(response);
  } catch (err) {
    console.error("Get products error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router2.get("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const product = await prisma2.product.findFirst({
      where: { id: String(req.params.id) },
      include: {
        category: true,
        brand: true,
        images: true,
        unitConversions: true,
        serials: true
      }
    });
    if (!product) return res.status(404).json({ success: false, error: "Product not found" });
    res.json({
      success: true,
      data: {
        ...product,
        createdAt: product.createdAt.toISOString(),
        updatedAt: product.updatedAt.toISOString()
      }
    });
  } catch (err) {
    console.error("Get product error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router2.post("/", authMiddleware, requireRole("admin", "manager"), validate(CreateProductSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { unitConversions, images, ...productData } = req.body;
    const product = await prisma2.product.create({
      data: {
        ...productData,
        unitConversions: unitConversions?.length ? {
          createMany: { data: unitConversions }
        } : void 0,
        images: images?.length ? {
          createMany: { data: images }
        } : void 0
      },
      include: { category: true, brand: true, images: true, unitConversions: true }
    });
    res.status(201).json({
      success: true,
      data: {
        ...product,
        createdAt: product.createdAt.toISOString(),
        updatedAt: product.updatedAt.toISOString()
      }
    });
    cacheDel(`products:${req.user?.storeSchema || "default"}:*`).catch(() => {
    });
  } catch (err) {
    console.error("Create product error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router2.put("/:id", authMiddleware, requireRole("admin", "manager"), validate(UpdateProductSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const existing = await prisma2.product.findFirst({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ success: false, error: "Product not found" });
    const { unitConversions, images, ...rawUpdates } = req.body;
    const allowedFields = [
      "name",
      "sku",
      "barcode",
      "description",
      "categoryId",
      "brandId",
      "costPrice",
      "sellingPrice",
      "taxInclusive",
      "stock",
      "minStock",
      "maxStock",
      "baseUnit",
      "trackSerial",
      "productType"
    ];
    const updates = {};
    for (const key of allowedFields) {
      if (rawUpdates[key] !== void 0) updates[key] = rawUpdates[key];
    }
    if (unitConversions) {
      await prisma2.unitConversion.deleteMany({ where: { productId: String(req.params.id) } });
    }
    if (images) {
      await prisma2.productImage.deleteMany({ where: { productId: String(req.params.id) } });
    }
    const product = await prisma2.product.update({
      where: { id: String(req.params.id) },
      data: {
        ...updates,
        unitConversions: unitConversions?.length ? {
          createMany: { data: unitConversions }
        } : void 0,
        images: images?.length ? {
          createMany: { data: images }
        } : void 0
      },
      include: { category: true, brand: true, images: true, unitConversions: true }
    });
    res.json({
      success: true,
      data: {
        ...product,
        createdAt: product.createdAt.toISOString(),
        updatedAt: product.updatedAt.toISOString()
      }
    });
    cacheDel(`products:${req.user?.storeSchema || "default"}:*`).catch(() => {
    });
  } catch (err) {
    console.error("Update product error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router2.delete("/:id", authMiddleware, requireRole("admin", "manager"), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const existing = await prisma2.product.findFirst({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ success: false, error: "Product not found" });
    await prisma2.product.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
    cacheDel(`products:${req.user?.storeSchema || "default"}:*`).catch(() => {
    });
  } catch (err) {
    console.error("Delete product error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router2.post("/bulk-import", authMiddleware, requireRole("admin", "manager"), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, error: "No rows provided" });
    }
    const allCategories = await prisma2.category.findMany({ where: { ...getBranchFilter(req) } });
    const catByName = /* @__PURE__ */ new Map();
    for (const c of allCategories) catByName.set(c.name.toLowerCase(), c.id);
    async function findOrCreateCategory2(name, level, parentId) {
      const key = (parentId ? parentId + ":" : "") + name.toLowerCase();
      if (catByName.has(key)) return catByName.get(key);
      const existing = await prisma2.category.findFirst({
        where: { name, level, parentId: parentId || null }
      });
      if (existing) {
        catByName.set(key, existing.id);
        return existing.id;
      }
      const created2 = await prisma2.category.create({
        data: { name, level, parentId: parentId || null }
      });
      catByName.set(key, created2.id);
      return created2.id;
    }
    const existingProducts = await prisma2.product.findMany({
      where: { ...getBranchFilter(req) },
      select: { id: true, sku: true, stock: true }
    });
    const productBySku = /* @__PURE__ */ new Map();
    for (const p of existingProducts) productBySku.set(p.sku, { id: p.id, stock: p.stock });
    let created = 0, updated = 0, skipped = 0, errors = [];
    for (const row of rows) {
      try {
        if (!row.name || !row.sku) {
          skipped++;
          continue;
        }
        const existing = productBySku.get(row.sku);
        let categoryId;
        if (row.category) {
          const names = row.category.split(">").map((s) => s.trim());
          let parentId;
          for (let i = 0; i < names.length; i++) {
            parentId = await findOrCreateCategory2(names[i], i + 1, parentId);
          }
          categoryId = parentId;
        }
        if (!categoryId) {
          categoryId = await findOrCreateCategory2("Chung", 1);
        }
        const productData = {
          name: row.name,
          sku: row.sku,
          barcode: row.barcode || null,
          description: row.description || null,
          categoryId,
          costPrice: parseFloat(row.costPrice) || 0,
          sellingPrice: parseFloat(row.sellingPrice) || 0,
          stock: parseInt(row.stock) || 0,
          minStock: parseInt(row.minStock) || 0,
          baseUnit: row.unit || "C\xE1i"
        };
        if (existing) {
          await prisma2.product.update({ where: { id: existing.id }, data: productData });
          updated++;
        } else {
          await prisma2.product.create({ data: productData });
          created++;
        }
      } catch (err) {
        errors.push(`${row.sku || "unknown"}: ${err.message?.slice(0, 60)}`);
        if (errors.length >= 10) break;
      }
    }
    res.json({ success: true, created, updated, skipped, errors: errors.slice(0, 10) });
  } catch (err) {
    console.error("Bulk import error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var products_default = router2;

// src/routes/categories.ts
var import_express3 = require("express");
var router3 = (0, import_express3.Router)();
router3.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { format, parentId, level } = req.query;
    const where = {};
    if (parentId) where.parentId = parentId;
    if (level) where.level = parseInt(level);
    if (format === "tree") {
      const allCategories = await prisma2.category.findMany({
        where: { ...getBranchFilter(req) },
        orderBy: [{ level: "asc" }, { name: "asc" }],
        include: { _count: { select: { products: true } } }
      });
      const roots = allCategories.filter((c) => c.level === 1);
      const tree = roots.map((root) => {
        const subs = allCategories.filter((c) => c.parentId === root.id).map((sub) => ({
          ...mapCategory(sub),
          productCount: sub._count.products,
          children: allCategories.filter((c) => c.parentId === sub.id).map((leaf) => ({
            ...mapCategory(leaf),
            productCount: leaf._count.products,
            children: []
          }))
        }));
        return {
          ...mapCategory(root),
          productCount: root._count.products,
          children: subs
        };
      });
      res.json({ success: true, data: tree });
    } else {
      const categories = await prisma2.category.findMany({
        where,
        orderBy: [{ level: "asc" }, { name: "asc" }],
        include: {
          parent: { select: { id: true, name: true } },
          _count: { select: { products: true, children: true } },
          products: {
            select: { stock: true, costPrice: true, sellingPrice: true, minStock: true }
          }
        }
      });
      const data = categories.map((c) => {
        const prods = c.products ?? [];
        const totalStock = prods.reduce((s, p) => s + (p.stock ?? 0), 0);
        const totalStockValue = prods.reduce((s, p) => s + (p.costPrice ?? 0) * (p.stock ?? 0), 0);
        const totalRetailValue = prods.reduce((s, p) => s + (p.sellingPrice ?? 0) * (p.stock ?? 0), 0);
        const outOfStockCount = prods.filter((p) => (p.stock ?? 0) <= 0).length;
        const lowStockCount = prods.filter((p) => (p.stock ?? 0) > 0 && (p.stock ?? 0) <= (p.minStock ?? 5)).length;
        return {
          ...mapCategory(c),
          parentName: c.parent?.name ?? null,
          productCount: c._count?.products ?? 0,
          childrenCount: c._count?.children ?? 0,
          totalStock,
          totalStockValue,
          totalRetailValue,
          outOfStockCount,
          lowStockCount
        };
      });
      res.json({ success: true, data });
    }
  } catch (err) {
    console.error("Get categories error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router3.get("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const category = await prisma2.category.findFirst({
      where: { id: req.params.id },
      include: {
        parent: { select: { id: true, name: true } },
        children: { include: { children: true, _count: { select: { products: true } } } },
        _count: { select: { products: true } }
      }
    });
    if (!category) {
      res.status(404).json({ success: false, error: "Category not found" });
      return;
    }
    res.json({
      success: true,
      data: {
        ...mapCategory(category),
        parent: category.parent,
        children: category.children.map((c) => ({
          ...mapCategory(c),
          productCount: c._count?.products ?? 0,
          children: c.children?.map((gc) => ({ ...mapCategory(gc) })) ?? []
        })),
        productCount: category._count.products
      }
    });
  } catch (err) {
    console.error("Get category error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router3.post("/", authMiddleware, validate(CreateCategorySchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { name, description, color, parentId } = req.body;
    if (!name) {
      res.status(400).json({ success: false, error: "Name is required" });
      return;
    }
    let level = 1;
    if (parentId) {
      const parent = await prisma2.category.findUnique({ where: { id: parentId }, select: { level: true } });
      if (!parent) {
        res.status(400).json({ success: false, error: "Parent category not found" });
        return;
      }
      if (parent.level >= 3) {
        res.status(400).json({ success: false, error: "Maximum 3 levels allowed" });
        return;
      }
      level = parent.level + 1;
    }
    const category = await prisma2.category.create({ data: { name, description, color, parentId, level } });
    res.status(201).json({ success: true, data: mapCategory(category) });
  } catch (err) {
    console.error("Create category error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router3.put("/:id", authMiddleware, validate(UpdateCategorySchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { name, description, color, parentId } = req.body;
    const catId = String(req.params.id);
    const existing = await prisma2.category.findFirst({ where: { id: catId } });
    if (!existing) {
      res.status(404).json({ success: false, error: "Category not found" });
      return;
    }
    let level = existing.level;
    if (parentId !== void 0 && parentId !== existing.parentId) {
      if (parentId === null) {
        level = 1;
      } else {
        const parent = await prisma2.category.findUnique({ where: { id: parentId }, select: { level: true } });
        if (!parent) {
          res.status(400).json({ success: false, error: "Parent category not found" });
          return;
        }
        if (parent.level >= 3) {
          res.status(400).json({ success: false, error: "Maximum 3 levels allowed" });
          return;
        }
        level = parent.level + 1;
      }
    }
    const category = await prisma2.category.update({
      where: { id: req.params.id },
      data: { ...name !== void 0 && { name }, ...description !== void 0 && { description }, ...color !== void 0 && { color }, ...parentId !== void 0 && { parentId }, level }
    });
    res.json({ success: true, data: mapCategory(category) });
  } catch (err) {
    console.error("Update category error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router3.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const childCount = await prisma2.category.count({ where: { parentId: req.params.id } });
    if (childCount > 0) {
      res.status(400).json({ success: false, error: `Cannot delete: has ${childCount} sub-categories` });
      return;
    }
    const productCount = await prisma2.product.count({ where: { categoryId: req.params.id } });
    if (productCount > 0) {
      res.status(400).json({ success: false, error: `Cannot delete: has ${productCount} products` });
      return;
    }
    await prisma2.category.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Category deleted" });
  } catch (err) {
    console.error("Delete category error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
function mapCategory(c) {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    color: c.color,
    level: c.level,
    parentId: c.parentId,
    createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt
  };
}
var categories_default = router3;

// src/routes/brands.ts
var import_express4 = require("express");
var router4 = (0, import_express4.Router)();
router4.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const brands = await prisma2.brand.findMany({
      where: { ...getBranchFilter(req) },
      orderBy: { createdAt: "desc" }
    });
    res.json(brands.map((b) => ({ ...b, createdAt: b.createdAt.toISOString() })));
  } catch (err) {
    console.error("Get brands error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router4.post("/", authMiddleware, validate(CreateBrandSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const brand = await prisma2.brand.create({ data: { ...req.body } });
    res.status(201).json({ success: true, data: { ...brand, createdAt: brand.createdAt.toISOString() } });
  } catch (err) {
    console.error("Create brand error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router4.put("/:id", authMiddleware, validate(UpdateBrandSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { id } = req.params;
    const { name, description } = req.body;
    const existing = await prisma2.brand.findFirst({
      where: { id: String(id), ...getBranchFilter(req) }
    });
    if (!existing) return res.status(404).json({ success: false, error: "Brand not found" });
    if (name) {
      const dup = await prisma2.brand.findFirst({
        where: { name, id: { not: String(id) }, ...getBranchFilter(req) }
      });
      if (dup) return res.status(409).json({ success: false, error: "Brand name already exists" });
    }
    const brand = await prisma2.brand.update({
      where: { id: String(id) },
      data: {
        ...name !== void 0 && { name },
        ...description !== void 0 && { description }
      }
    });
    res.json({ success: true, data: { ...brand, createdAt: brand.createdAt.toISOString() } });
  } catch (err) {
    console.error("Update brand error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router4.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { id } = req.params;
    const existing = await prisma2.brand.findFirst({
      where: { id: String(id), ...getBranchFilter(req) }
    });
    if (!existing) return res.status(404).json({ success: false, error: "Brand not found" });
    const productCount = await prisma2.product.count({ where: { brandId: String(id) } });
    if (productCount > 0) {
      return res.status(409).json({
        success: false,
        error: `Cannot delete brand: ${productCount} product(s) are using this brand. Remove or reassign them first.`
      });
    }
    await prisma2.brand.delete({ where: { id: String(id) } });
    res.json({ success: true, message: "Brand deleted successfully" });
  } catch (err) {
    console.error("Delete brand error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var brands_default = router4;

// src/routes/customers.ts
var import_express5 = require("express");
var router5 = (0, import_express5.Router)();
router5.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { search, groupId, page = "1", pageSize = "20" } = req.query;
    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { phone: { contains: search } },
        { code: { contains: search } },
        { email: { contains: search } }
      ];
    }
    if (groupId) where.groupId = groupId;
    const pageNum = Math.max(1, parseInt(page));
    const size = Math.max(1, Math.min(100, parseInt(pageSize)));
    const skip2 = (pageNum - 1) * size;
    const [total, customers] = await Promise.all([
      prisma2.customer.count({ where }),
      prisma2.customer.findMany({
        where,
        include: { group: true },
        orderBy: { createdAt: "desc" },
        skip: skip2,
        take: size
      })
    ]);
    const data = customers.map((c) => ({
      ...c,
      lastPurchaseDate: c.lastPurchaseDate?.toISOString(),
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString()
    }));
    res.json({
      success: true,
      data: {
        items: data,
        total,
        page: pageNum,
        pageSize: size,
        totalPages: Math.ceil(total / size)
      }
    });
  } catch (err) {
    console.error("Get customers error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router5.get("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    if (req.params.id === "groups") {
      return res.redirect("/api/customer-groups");
    }
    const customer = await prisma2.customer.findFirst({
      where: { id: String(req.params.id) },
      include: { group: true }
    });
    if (!customer) {
      res.status(404).json({ success: false, error: "Customer not found" });
      return;
    }
    res.json({
      success: true,
      data: {
        ...customer,
        lastPurchaseDate: customer.lastPurchaseDate?.toISOString(),
        createdAt: customer.createdAt.toISOString(),
        updatedAt: customer.updatedAt.toISOString()
      }
    });
  } catch (err) {
    console.error("Get customer error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router5.get("/:id/purchases", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const transactions = await prisma2.transaction.findMany({
      where: { customerId: String(req.params.id) },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { items: true }
    });
    const purchases = transactions.map((t) => ({
      id: t.id,
      orderId: t.id,
      customerId: String(req.params.id),
      date: t.createdAt.toISOString(),
      items: t.items.length,
      total: t.total,
      status: t.status === "voided" ? "cancelled" : t.status === "returned" ? "cancelled" : "completed"
    }));
    res.json(purchases);
  } catch (err) {
    console.error("Get customer purchases error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router5.post("/", authMiddleware, validate(CreateCustomerSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { name, phone, email, address, notes, groupId } = req.body;
    if (!name) {
      res.status(400).json({ success: false, error: "Name is required" });
      return;
    }
    let code = req.body.code;
    if (!code) {
      const lastCustomer = await prisma2.customer.findFirst({
        orderBy: { code: "desc" },
        where: { code: { startsWith: "KH" } },
        select: { code: true }
      });
      const lastNum = lastCustomer ? parseInt(lastCustomer.code.replace("KH", "")) || 0 : 0;
      code = `KH${String(lastNum + 1).padStart(3, "0")}`;
    }
    const customer = await prisma2.customer.create({
      data: {
        code,
        name,
        phone: phone || "",
        email: email || null,
        address: address || null,
        notes: notes || null,
        groupId: groupId || null
      },
      include: { group: true }
    });
    res.status(201).json({
      success: true,
      data: {
        ...customer,
        lastPurchaseDate: customer.lastPurchaseDate?.toISOString(),
        createdAt: customer.createdAt.toISOString(),
        updatedAt: customer.updatedAt.toISOString()
      }
    });
  } catch (err) {
    console.error("Create customer error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router5.put("/:id", authMiddleware, validate(UpdateCustomerSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const existing = await prisma2.customer.findFirst({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ success: false, error: "Customer not found" });
    const { name, phone, email, address, groupId, taxCode, note, loyaltyPoints } = req.body;
    const customer = await prisma2.customer.update({
      where: { id: existing.id },
      data: {
        ...name !== void 0 && { name },
        ...phone !== void 0 && { phone },
        ...email !== void 0 && { email },
        ...address !== void 0 && { address },
        ...groupId !== void 0 && { groupId },
        ...taxCode !== void 0 && { taxCode },
        ...note !== void 0 && { note },
        ...loyaltyPoints !== void 0 && { loyaltyPoints }
      }
    });
    res.json({
      success: true,
      data: {
        ...customer,
        lastPurchaseDate: customer.lastPurchaseDate?.toISOString(),
        createdAt: customer.createdAt.toISOString(),
        updatedAt: customer.updatedAt.toISOString()
      }
    });
  } catch (err) {
    console.error("Update customer error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router5.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const toDelete = await prisma2.customer.findFirst({ where: { id: String(req.params.id) } });
    if (!toDelete) return res.status(404).json({ success: false, error: "Customer not found" });
    await prisma2.customer.delete({ where: { id: toDelete.id } });
    res.json({ success: true, message: "Customer deleted" });
  } catch (err) {
    console.error("Delete customer error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router5.post("/:id/pay-debt", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { amount, method, reference, note } = req.body;
    if (!amount || amount <= 0) {
      res.status(400).json({ success: false, error: "Amount must be positive" });
      return;
    }
    const customer = await prisma2.customer.findFirst({
      where: { id: String(req.params.id) }
    });
    if (!customer) {
      res.status(404).json({ success: false, error: "Customer not found" });
      return;
    }
    const payAmount = Math.min(amount, customer.debt);
    const updated = await prisma2.customer.update({
      where: { id: String(req.params.id) },
      data: {
        debt: { decrement: payAmount }
      },
      include: { group: true }
    });
    console.log(`\u{1F4B0} Customer ${customer.name} paid debt: ${payAmount} (remaining: ${updated.debt})`);
    res.json({
      success: true,
      data: {
        ...updated,
        paidAmount: payAmount,
        remainingDebt: updated.debt,
        lastPurchaseDate: updated.lastPurchaseDate?.toISOString(),
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString()
      }
    });
  } catch (err) {
    console.error("Pay customer debt error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var customers_default = router5;

// src/routes/customerGroups.ts
var import_express6 = require("express");
var router6 = (0, import_express6.Router)();
router6.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const groups = await prisma2.customerGroup.findMany({
      include: { _count: { select: { customers: true } } },
      orderBy: { name: "asc" }
    });
    res.json({ success: true, data: groups });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router6.post("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { name, discount, color } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: "Group name required" });
    const group = await prisma2.customerGroup.create({
      data: { name: name.trim(), discount: Number(discount) || 0, color: color || "#6366f1" }
    });
    res.status(201).json({ success: true, data: group });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router6.put("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { name, discount, color } = req.body;
    const group = await prisma2.customerGroup.update({
      where: { id: String(req.params.id) },
      data: { name, discount: Number(discount) || 0, color }
    });
    res.json({ success: true, data: group });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router6.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    await prisma2.customerGroup.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var customerGroups_default = router6;

// src/routes/inventory.ts
var import_express7 = require("express");
var router7 = (0, import_express7.Router)();
router7.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const [totalProducts, lowStock, outOfStock, agg] = await Promise.all([
      prisma2.product.count(),
      prisma2.product.count({ where: { stock: { gt: 0, lte: 10 } } }),
      prisma2.product.count({ where: { stock: { lte: 0 } } }),
      prisma2.product.aggregate({ _sum: { stock: true } })
    ]);
    res.json({ success: true, data: { totalProducts, lowStock, outOfStock, totalStock: agg._sum.stock || 0 } });
  } catch (err) {
    console.error("Inventory summary error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router7.get("/transactions", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { search, type, productId, startDate, endDate, page = "1", pageSize = "20" } = req.query;
    const where = {};
    if (productId) where.productId = productId;
    if (search) {
      where.OR = [
        { productName: { contains: search } },
        { productSku: { contains: search } }
      ];
    }
    if (type) where.type = type;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }
    const pageNum = Math.max(1, parseInt(page));
    const size = Math.max(1, Math.min(100, parseInt(pageSize)));
    const skip2 = (pageNum - 1) * size;
    const [total, transactions] = await Promise.all([
      prisma2.inventoryTransaction.count({ where }),
      prisma2.inventoryTransaction.findMany({ where, orderBy: { createdAt: "desc" }, skip: skip2, take: size })
    ]);
    res.json({
      data: transactions.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
      total,
      page: pageNum,
      pageSize: size,
      totalPages: Math.ceil(total / size)
    });
  } catch (err) {
    console.error("Get inventory transactions error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router7.get("/receipts", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const receipts = await prisma2.importReceipt.findMany({
      where: { ...getBranchFilter(req) },
      include: { items: true },
      orderBy: { createdAt: "desc" }
    });
    res.json(receipts.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString()
    })));
  } catch (err) {
    console.error("Get import receipts error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router7.post("/receipts", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { items, ...receiptData } = req.body;
    const count = await prisma2.importReceipt.count({ where: { ...getBranchFilter(req) } });
    const code = `PN${String(count + 1).padStart(3, "0")}`;
    const receipt = await prisma2.importReceipt.create({
      data: {
        ...receiptData,
        code,
        userId: req.user.userId,
        userName: receiptData.userName || "Admin",
        items: {
          create: items.map((item) => ({
            productId: item.productId,
            productName: item.productName,
            productSku: item.productSku,
            quantity: item.quantity,
            costPrice: item.costPrice,
            total: item.total || item.quantity * item.costPrice
          }))
        }
      },
      include: { items: true }
    });
    for (const item of items) {
      await prisma2.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } }
      });
      await prisma2.inventoryTransaction.create({
        data: {
          type: "import",
          productId: item.productId,
          productName: item.productName,
          productSku: item.productSku,
          quantity: item.quantity,
          reason: `Nh\u1EADp kho theo phi\u1EBFu ${code}`,
          referenceId: code,
          referenceType: "import_receipt",
          unitPrice: item.costPrice || 0,
          costPriceAfter: item.costPrice || 0,
          supplierId: receiptData.supplierId,
          supplierName: receiptData.supplierName,
          userId: req.user.userId,
          userName: receiptData.userName || "Admin"
        }
      });
    }
    res.status(201).json({
      success: true,
      data: { ...receipt, createdAt: receipt.createdAt.toISOString(), updatedAt: receipt.updatedAt.toISOString() }
    });
  } catch (err) {
    console.error("Create import receipt error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router7.post("/adjustments", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { productId, productName, productSku, quantity, reason, note, userId, userName } = req.body;
    await prisma2.product.update({
      where: { id: productId },
      data: { stock: { increment: quantity } }
    });
    const transaction = await prisma2.inventoryTransaction.create({
      data: {
        type: "adjustment",
        productId,
        productName,
        productSku,
        quantity,
        reason,
        note,
        userId: userId || req.user.userId,
        userName: userName || "Admin"
      }
    });
    res.status(201).json({
      success: true,
      data: { ...transaction, createdAt: transaction.createdAt.toISOString() }
    });
  } catch (err) {
    console.error("Stock adjustment error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var inventory_default = router7;

// src/routes/transactions.ts
var import_express8 = require("express");
var router8 = (0, import_express8.Router)();
router8.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const {
      search,
      startDate,
      endDate,
      paymentMethod,
      status,
      cashier,
      page = "1",
      pageSize = "20"
    } = req.query;
    const where = {};
    if (search) {
      where.OR = [
        { receiptNumber: { contains: search } },
        { customerName: { contains: search } },
        { customerPhone: { contains: search } }
      ];
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }
    if (status && status !== "all") where.status = status;
    if (cashier) where.createdBy = cashier;
    const pageNum = Math.max(1, parseInt(page));
    const size = Math.max(1, Math.min(100, parseInt(pageSize)));
    const skip2 = (pageNum - 1) * size;
    const [total, transactions] = await Promise.all([
      prisma2.transaction.count({ where }),
      prisma2.transaction.findMany({
        where,
        include: { items: true, payments: true },
        orderBy: { createdAt: "desc" },
        skip: skip2,
        take: size
      })
    ]);
    let filteredTx = transactions;
    let filteredTotal = total;
    if (paymentMethod && paymentMethod !== "all") {
      filteredTx = transactions.filter(
        (t) => t.payments.some((p) => p.type === paymentMethod)
      );
      filteredTotal = filteredTx.length;
    }
    const data = filteredTx.map((t) => ({
      id: t.id,
      receiptNumber: t.receiptNumber,
      customerId: t.customerId,
      customerName: t.customerName,
      customerPhone: t.customerPhone,
      items: t.items.map((i) => ({
        productId: i.productId,
        productName: i.productName,
        sku: i.sku,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        discount: i.discount,
        lineTotal: i.lineTotal
      })),
      subtotal: t.subtotal,
      discount: t.discount,
      tax: t.tax,
      total: t.total,
      payments: t.payments.map((p) => ({
        type: p.type,
        amount: p.amount,
        reference: p.reference
      })),
      amountReceived: t.amountReceived,
      change: t.change,
      status: t.status,
      createdBy: t.createdBy,
      createdByName: t.createdByName,
      notes: t.notes,
      createdAt: t.createdAt.toISOString(),
      transactionDate: t.transactionDate?.toISOString() || t.createdAt.toISOString(),
      returnedAt: t.returnedAt?.toISOString(),
      returnReason: t.returnReason
    }));
    res.json({
      success: true,
      data: {
        items: data,
        total: filteredTotal,
        page: pageNum,
        pageSize: size,
        totalPages: Math.ceil(filteredTotal / size)
      }
    });
  } catch (err) {
    console.error("Get transactions error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router8.get("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const transaction = await prisma2.transaction.findUnique({
      where: { id: String(req.params.id) },
      include: { items: true, payments: true }
    });
    if (!transaction) {
      res.status(404).json({ success: false, error: "Transaction not found" });
      return;
    }
    res.json({
      success: true,
      data: {
        ...transaction,
        createdAt: transaction.createdAt.toISOString(),
        returnedAt: transaction.returnedAt?.toISOString()
      }
    });
  } catch (err) {
    console.error("Get transaction error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router8.post("/", authMiddleware, validate(CreateTransactionSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const { items, payments, ...txData } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ success: false, error: "Items are required" });
      return;
    }
    const user = await prisma2.user.findUnique({ where: { id: req.user.userId } });
    const count = await prisma2.transaction.count();
    const receiptNumber = txData.receiptNumber || `HD${Date.now()}${String(count + 1).padStart(4, "0")}`;
    const debtAmount = txData.debtAmount || 0;
    const createData = {
      receiptNumber,
      subtotal: txData.subtotal || 0,
      discount: txData.discount || 0,
      tax: txData.tax || 0,
      total: txData.total || 0,
      amountReceived: txData.amountReceived || 0,
      change: txData.change || 0,
      status: txData.status || "completed",
      createdBy: req.user.userId,
      createdByName: user?.name || "Admin",
      notes: txData.notes || null,
      transactionDate: txData.transactionDate ? new Date(txData.transactionDate) : null,
      items: {
        create: items.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          sku: item.sku || item.productSku || "",
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount || 0,
          lineTotal: item.lineTotal
        }))
      }
    };
    if (txData.customerId) {
      createData.customerId = txData.customerId;
      createData.customerName = txData.customerName || null;
      createData.customerPhone = txData.customerPhone || null;
    }
    if (payments && Array.isArray(payments) && payments.length > 0) {
      createData.payments = {
        create: payments.map((p) => ({
          type: p.type,
          amount: p.amount,
          reference: p.reference || null
        }))
      };
    }
    const transaction = await prisma2.transaction.create({
      data: createData,
      include: { items: true, payments: true }
    });
    for (const item of items) {
      const updatedProduct = await prisma2.product.update({
        where: { id: item.productId },
        data: { stock: { decrement: item.quantity } }
      });
      await prisma2.inventoryTransaction.create({
        data: {
          type: "sale",
          productId: item.productId,
          productName: item.productName,
          productSku: item.sku || item.productSku || "",
          quantity: -item.quantity,
          reason: `B\xE1n h\xE0ng - ${receiptNumber}`,
          note: `Giao d\u1ECBch ${receiptNumber}`,
          referenceId: receiptNumber,
          referenceType: "sale",
          unitPrice: item.unitPrice || 0,
          costPriceAfter: updatedProduct.costPrice,
          userId: req.user.userId,
          userName: user?.name || "Admin"
        }
      });
    }
    if (txData.customerId) {
      const customerUpdate = {
        totalPurchases: { increment: transaction.total },
        totalOrders: { increment: 1 },
        lastPurchaseDate: /* @__PURE__ */ new Date()
      };
      if (debtAmount > 0) {
        customerUpdate.debt = { increment: debtAmount };
      }
      await prisma2.customer.update({
        where: { id: txData.customerId },
        data: customerUpdate
      });
      try {
        const customer = await prisma2.customer.findUnique({ where: { id: txData.customerId } });
        if (customer) {
          const earnedPoints = Math.floor(transaction.total / 1e3);
          if (earnedPoints > 0) {
            const newPoints = (customer.loyaltyPoints || 0) + earnedPoints;
            const cumulative = customer.totalPurchases || 0;
            let newTier = customer.tier || "bronze";
            if (cumulative >= 5e7) newTier = "vip";
            else if (cumulative >= 2e7) newTier = "gold";
            else if (cumulative >= 5e6) newTier = "silver";
            else newTier = "bronze";
            await prisma2.customer.update({
              where: { id: txData.customerId },
              data: {
                loyaltyPoints: newPoints,
                loyaltyTier: newTier
              }
            });
            console.log(`[Loyalty] Customer ${customer.name}: +${earnedPoints} pts \u2192 ${newPoints} (tier: ${newTier})`);
          }
        }
      } catch (loyaltyErr) {
        console.warn("[Loyalty] Points update failed (non-critical):", loyaltyErr);
      }
    }
    console.log(`\u2705 Transaction ${receiptNumber} created \u2014 ${items.length} items, total: ${transaction.total}`);
    res.status(201).json({
      success: true,
      data: {
        ...transaction,
        createdAt: transaction.createdAt.toISOString(),
        transactionDate: transaction.transactionDate?.toISOString() || transaction.createdAt.toISOString()
      }
    });
  } catch (err) {
    console.error("Create transaction error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router8.put("/:id/void", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const existing = await prisma2.transaction.findUnique({
      where: { id: String(req.params.id) },
      include: { items: true }
    });
    if (!existing) {
      res.status(404).json({ success: false, error: "Transaction not found" });
      return;
    }
    if (existing.status === "voided" || existing.status === "returned") {
      res.status(400).json({ success: false, error: "Transaction already voided/returned" });
      return;
    }
    const user = await prisma2.user.findUnique({ where: { id: req.user.userId } });
    const transaction = await prisma2.transaction.update({
      where: { id: String(req.params.id) },
      data: { status: "voided" },
      include: { items: true }
    });
    for (const item of transaction.items) {
      const updatedProduct = await prisma2.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } }
      });
      await prisma2.inventoryTransaction.create({
        data: {
          type: "adjustment",
          productId: item.productId,
          productName: item.productName,
          productSku: item.sku,
          quantity: item.quantity,
          reason: `H\u1EE7y \u0111\u01A1n - ${existing.receiptNumber}`,
          note: `Ho\xE0n kho do h\u1EE7y giao d\u1ECBch ${existing.receiptNumber}`,
          referenceId: existing.receiptNumber,
          referenceType: "void",
          unitPrice: item.unitPrice || 0,
          costPriceAfter: updatedProduct.costPrice,
          userId: req.user.userId,
          userName: user?.name || "Admin"
        }
      });
    }
    if (existing.customerId) {
      await prisma2.customer.update({
        where: { id: existing.customerId },
        data: {
          totalPurchases: { decrement: existing.total },
          totalOrders: { decrement: 1 }
        }
      });
    }
    console.log(`\u{1F6AB} Transaction ${existing.receiptNumber} voided`);
    res.json({
      success: true,
      data: {
        ...transaction,
        createdAt: transaction.createdAt.toISOString()
      }
    });
  } catch (err) {
    console.error("Void transaction error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router8.put("/:id/return", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const { reason, returnItems } = req.body;
    const existing = await prisma2.transaction.findUnique({
      where: { id: String(req.params.id) },
      include: { items: true }
    });
    if (!existing) {
      res.status(404).json({ success: false, error: "Transaction not found" });
      return;
    }
    if (existing.status === "returned" || existing.status === "voided") {
      res.status(400).json({ success: false, error: "Transaction already returned/voided" });
      return;
    }
    const user = await prisma2.user.findUnique({ where: { id: req.user.userId } });
    const itemsToReturn = returnItems && Array.isArray(returnItems) && returnItems.length > 0 ? existing.items.filter((i) => returnItems.some((ri) => ri.productId === i.productId)) : existing.items;
    const returnQtyMap = /* @__PURE__ */ new Map();
    if (returnItems && Array.isArray(returnItems) && returnItems.length > 0) {
      for (const ri of returnItems) {
        returnQtyMap.set(ri.productId, ri.quantity || existing.items.find((i) => i.productId === ri.productId)?.quantity || 0);
      }
    } else {
      for (const item of itemsToReturn) {
        returnQtyMap.set(item.productId, item.quantity);
      }
    }
    const returnTotal = itemsToReturn.reduce((sum, item) => {
      const qty = returnQtyMap.get(item.productId) || item.quantity;
      return sum + item.unitPrice * qty;
    }, 0);
    const transaction = await prisma2.transaction.update({
      where: { id: String(req.params.id) },
      data: {
        status: "returned",
        returnedAt: /* @__PURE__ */ new Date(),
        returnReason: reason || "Tr\u1EA3 h\xE0ng"
      },
      include: { items: true, payments: true }
    });
    const returnCount = await prisma2.returnOrder.count();
    const returnCode = `RT-${String(returnCount + 1).padStart(3, "0")}`;
    const returnItemsJson = itemsToReturn.map((item) => ({
      productName: item.productName,
      sku: item.sku,
      quantity: returnQtyMap.get(item.productId) || item.quantity,
      unitPrice: item.unitPrice,
      productId: item.productId
    }));
    let returnOrder = null;
    try {
      returnOrder = await prisma2.returnOrder.create({
        data: {
          code: returnCode,
          originalInvoice: existing.receiptNumber,
          customerName: existing.customerName || "Kh\xE1ch l\u1EBB",
          customerPhone: existing.customerPhone || null,
          reason: reason || "Tr\u1EA3 h\xE0ng",
          items: JSON.stringify(returnItemsJson),
          totalRefund: returnTotal,
          status: "completed",
          processedAt: /* @__PURE__ */ new Date(),
          notes: `Tr\u1EA3 h\xE0ng t\u1EEB giao d\u1ECBch ${existing.receiptNumber}`
        }
      });
    } catch (roErr) {
      console.warn(`\u26A0\uFE0F ReturnOrder table not ready: ${roErr.message} \u2014 returning without ReturnOrder record`);
    }
    for (const item of itemsToReturn) {
      const qty = returnQtyMap.get(item.productId) || item.quantity;
      const updatedProduct = await prisma2.product.update({
        where: { id: item.productId },
        data: { stock: { increment: qty } }
      });
      await prisma2.inventoryTransaction.create({
        data: {
          type: "return",
          productId: item.productId,
          productName: item.productName,
          productSku: item.sku,
          quantity: qty,
          reason: `Tr\u1EA3 h\xE0ng - ${returnCode} (${existing.receiptNumber})`,
          note: reason || `Tr\u1EA3 h\xE0ng giao d\u1ECBch ${existing.receiptNumber}`,
          referenceId: returnCode,
          referenceType: "return",
          unitPrice: item.unitPrice || 0,
          costPriceAfter: updatedProduct.costPrice,
          userId: req.user.userId,
          userName: user?.name || "Admin"
        }
      });
    }
    if (existing.customerId) {
      await prisma2.customer.update({
        where: { id: existing.customerId },
        data: {
          totalPurchases: { decrement: returnTotal },
          totalOrders: { decrement: 1 }
        }
      });
    }
    console.log(`\u21A9\uFE0F Transaction ${existing.receiptNumber} returned as ${returnCode} \u2014 ${itemsToReturn.length} items`);
    res.json({
      success: true,
      data: {
        ...transaction,
        createdAt: transaction.createdAt.toISOString(),
        returnedAt: transaction.returnedAt?.toISOString(),
        returnOrder: returnOrder ? {
          code: returnOrder.code,
          id: returnOrder.id,
          totalRefund: returnOrder.totalRefund,
          items: JSON.parse(returnOrder.items)
        } : { code: returnCode, totalRefund: returnTotal }
      }
    });
  } catch (err) {
    console.error("Return transaction error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router8.put("/:id/vat", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { vatInvoiceNumber, vatStatus } = req.body;
    const existing = await prisma2.transaction.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, error: "Transaction not found" });
    }
    const updateData = {};
    if (vatStatus === "issued") {
      const vatCount = await prisma2.transaction.count({ where: { ...getBranchFilter(req), vatStatus: "issued" } });
      updateData.vatInvoiceNumber = vatInvoiceNumber || `VAT-${String(vatCount + 1).padStart(6, "0")}`;
      updateData.vatIssuedAt = /* @__PURE__ */ new Date();
      updateData.vatStatus = "issued";
    } else if (vatStatus === "cancelled") {
      updateData.vatStatus = "cancelled";
    } else {
      updateData.vatStatus = "none";
      updateData.vatInvoiceNumber = null;
      updateData.vatIssuedAt = null;
    }
    const transaction = await prisma2.transaction.update({ where: { id }, data: updateData });
    console.log(`\u{1F9FE} Transaction ${existing.receiptNumber} VAT: ${updateData.vatStatus} (${updateData.vatInvoiceNumber || "N/A"})`);
    res.json({ success: true, data: transaction });
  } catch (err) {
    console.error("PUT /transactions/:id/vat error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var transactions_default = router8;

// src/routes/promotions.ts
var import_express9 = require("express");
var router9 = (0, import_express9.Router)();
router9.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { search, status, type, page = "1", pageSize = "20" } = req.query;
    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { code: { contains: search } }
      ];
    }
    if (status && status !== "all") where.status = status;
    if (type && type !== "all") where.type = type;
    const pageNum = Math.max(1, parseInt(page));
    const size = Math.max(1, Math.min(100, parseInt(pageSize)));
    const skip2 = (pageNum - 1) * size;
    const [total, promotions] = await Promise.all([
      prisma2.promotion.count({ where }),
      prisma2.promotion.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: skip2,
        take: size
      })
    ]);
    const data = promotions.map((p) => ({
      ...p,
      categoryIds: p.categoryIds ? JSON.parse(p.categoryIds) : [],
      productIds: p.productIds ? JSON.parse(p.productIds) : [],
      startDate: p.startDate.toISOString(),
      endDate: p.endDate.toISOString(),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString()
    }));
    res.json({
      data,
      total,
      page: pageNum,
      pageSize: size,
      totalPages: Math.ceil(total / size)
    });
  } catch (err) {
    console.error("Get promotions error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router9.post("/", authMiddleware, requireRole("admin", "manager"), validate(CreatePromotionSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { categoryIds, productIds, startDate, endDate, ...data } = req.body;
    const promotion = await prisma2.promotion.create({
      data: {
        ...data,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        categoryIds: categoryIds ? JSON.stringify(categoryIds) : null,
        productIds: productIds ? JSON.stringify(productIds) : null
      }
    });
    res.status(201).json({
      success: true,
      data: {
        ...promotion,
        categoryIds: promotion.categoryIds ? JSON.parse(promotion.categoryIds) : [],
        productIds: promotion.productIds ? JSON.parse(promotion.productIds) : [],
        startDate: promotion.startDate.toISOString(),
        endDate: promotion.endDate.toISOString(),
        createdAt: promotion.createdAt.toISOString(),
        updatedAt: promotion.updatedAt.toISOString()
      }
    });
  } catch (err) {
    console.error("Create promotion error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router9.put("/:id", authMiddleware, requireRole("admin", "manager"), validate(UpdatePromotionSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { categoryIds, productIds, startDate, endDate, ...updates } = req.body;
    const promoId = String(req.params.id);
    const data = { ...updates };
    if (startDate) data.startDate = new Date(startDate);
    if (endDate) data.endDate = new Date(endDate);
    if (categoryIds !== void 0) data.categoryIds = JSON.stringify(categoryIds);
    if (productIds !== void 0) data.productIds = JSON.stringify(productIds);
    const promotion = await prisma2.promotion.update({
      where: { id: promoId },
      data
    });
    res.json({
      success: true,
      data: {
        ...promotion,
        categoryIds: promotion.categoryIds ? JSON.parse(promotion.categoryIds) : [],
        productIds: promotion.productIds ? JSON.parse(promotion.productIds) : [],
        startDate: promotion.startDate.toISOString(),
        endDate: promotion.endDate.toISOString(),
        createdAt: promotion.createdAt.toISOString(),
        updatedAt: promotion.updatedAt.toISOString()
      }
    });
  } catch (err) {
    console.error("Update promotion error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router9.delete("/:id", authMiddleware, requireRole("admin", "manager"), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    await prisma2.promotion.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true, message: "Promotion deleted" });
  } catch (err) {
    console.error("Delete promotion error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var promotions_default = router9;

// src/routes/dashboard.ts
var import_express10 = require("express");

// src/lib/queries.ts
async function getDashboardStats(prisma2) {
  const now = /* @__PURE__ */ new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth() - 1, 0, 23, 59, 59, 999);
  const [
    totalRevenue,
    todayRevenue,
    thisMonthRevenue,
    lastMonthRevenue,
    totalOrders,
    todayOrders,
    lastMonthOrders,
    totalProducts,
    lowStockProducts,
    outOfStockProducts,
    totalCustomers,
    newCustomersThisMonth,
    newCustomersLastMonth,
    customersWithDebt,
    thisMonthExpenses,
    lastMonthExpenses
  ] = await Promise.all([
    prisma2.transaction.aggregate({ _sum: { total: true }, where: { status: { not: "voided" } } }),
    prisma2.transaction.aggregate({ _sum: { total: true }, where: { createdAt: { gte: todayStart }, status: { not: "voided" } } }),
    prisma2.transaction.aggregate({ _sum: { total: true }, where: { createdAt: { gte: monthStart }, status: { not: "voided" } } }),
    prisma2.transaction.aggregate({ _sum: { total: true }, where: { createdAt: { gte: lastMonthStart, lte: lastMonthEnd }, status: { not: "voided" } } }),
    prisma2.transaction.count({ where: { status: { not: "voided" } } }),
    prisma2.transaction.count({ where: { createdAt: { gte: todayStart }, status: { not: "voided" } } }),
    prisma2.transaction.count({ where: { createdAt: { gte: lastMonthStart, lte: lastMonthEnd }, status: { not: "voided" } } }),
    prisma2.product.count(),
    prisma2.product.count({ where: { stock: { gt: 0, lte: 10 } } }),
    prisma2.product.count({ where: { stock: { lte: 0 } } }),
    prisma2.customer.count(),
    prisma2.customer.count({ where: { createdAt: { gte: monthStart } } }),
    prisma2.customer.count({ where: { createdAt: { gte: lastMonthStart, lte: lastMonthEnd } } }),
    prisma2.customer.count({ where: { debt: { gt: 0 } } }),
    prisma2.expense.aggregate({ _sum: { amount: true }, where: { date: { gte: monthStart } } }),
    prisma2.expense.aggregate({ _sum: { amount: true }, where: { date: { gte: lastMonthStart, lte: lastMonthEnd } } })
  ]);
  const calcGrowth = (current, previous) => previous > 0 ? Math.round((current - previous) / previous * 100) : 0;
  const thisMonthRev = thisMonthRevenue._sum.total || 0;
  const lastMonthRev = lastMonthRevenue._sum.total || 0;
  const thisMonthExp = thisMonthExpenses._sum.amount || 0;
  const lastMonthExp = lastMonthExpenses._sum.amount || 0;
  return {
    revenue: {
      total: totalRevenue._sum.total || 0,
      today: todayRevenue._sum.total || 0,
      thisMonth: thisMonthRev,
      growth: calcGrowth(thisMonthRev, lastMonthRev)
    },
    orders: {
      total: totalOrders,
      today: todayOrders,
      pending: 0,
      growth: calcGrowth(todayOrders, Math.round(lastMonthOrders / 30))
    },
    products: {
      total: totalProducts,
      lowStock: lowStockProducts,
      outOfStock: outOfStockProducts,
      growth: 0
      // products don't grow month-over-month meaningfully
    },
    customers: {
      total: totalCustomers,
      newThisMonth: newCustomersThisMonth,
      withDebt: customersWithDebt,
      growth: calcGrowth(newCustomersThisMonth, newCustomersLastMonth)
    },
    expenses: {
      thisMonth: thisMonthExp,
      growth: calcGrowth(thisMonthExp, lastMonthExp)
    }
  };
}
async function getRevenueByDays(prisma2, days = 7) {
  const safetyDays = Math.min(90, Math.max(1, days));
  const since = /* @__PURE__ */ new Date();
  since.setDate(since.getDate() - safetyDays);
  since.setHours(0, 0, 0, 0);
  const transactions = await prisma2.transaction.findMany({
    where: {
      createdAt: { gte: since },
      status: { not: "voided" }
    },
    select: { total: true, subtotal: true, discount: true, createdAt: true },
    orderBy: { createdAt: "asc" }
  });
  const byDate = /* @__PURE__ */ new Map();
  for (let i = safetyDays - 1; i >= 0; i--) {
    const d = /* @__PURE__ */ new Date();
    d.setDate(d.getDate() - i);
    const key = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    byDate.set(key, { revenue: 0, orders: 0, profit: 0 });
  }
  for (const tx of transactions) {
    const d = tx.createdAt;
    const key = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    const entry = byDate.get(key);
    if (entry) {
      entry.revenue += tx.total;
      entry.orders += 1;
      entry.profit += tx.total - (tx.subtotal - tx.discount) * 0.7;
    }
  }
  return Array.from(byDate.entries()).map(([date, data]) => ({
    date,
    ...data
  }));
}
async function getTopProducts(prisma2, limit = 10) {
  const items = await prisma2.transactionItem.groupBy({
    by: ["productId", "productName"],
    _sum: { lineTotal: true, quantity: true },
    orderBy: { _sum: { lineTotal: "desc" } },
    take: limit
  });
  const COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#06b6d4", "#84cc16"];
  return items.map((item, i) => ({
    id: item.productId,
    name: item.productName,
    revenue: item._sum.lineTotal ?? 0,
    quantity: item._sum.quantity ?? 0,
    color: COLORS[i % COLORS.length]
  }));
}
async function getRecentActivity(prisma2, limit = 10) {
  const transactions = await prisma2.transaction.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, receiptNumber: true, customerName: true, total: true, status: true, createdAt: true }
  });
  return transactions.map((t) => ({
    id: t.id,
    type: "sale",
    description: `B\xE1n h\xE0ng${t.customerName ? ` cho ${t.customerName}` : ""}`,
    amount: t.total,
    time: t.createdAt.toISOString(),
    status: t.status
  }));
}

// src/routes/dashboard.ts
var router10 = (0, import_express10.Router)();
router10.get("/stats", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const schema = req.user?.storeSchema || "unknown";
    const cacheKey = `${schema}:dashboard:stats`;
    const cached = await cacheGet(cacheKey);
    if (cached) return res.json({ success: true, source: "cache", data: cached });
    const stats = await getDashboardStats(prisma2);
    await cacheSet(cacheKey, stats, 30);
    res.json({ success: true, source: "prisma", data: stats });
  } catch (err) {
    console.error("Get dashboard stats error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router10.get("/revenue", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const schema = req.user?.storeSchema || "unknown";
    const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 7));
    const cacheKey = `${schema}:dashboard:revenue:${days}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return res.json({ success: true, data: cached, source: "cache" });
    const data = await getRevenueByDays(prisma2, days);
    await cacheSet(cacheKey, data, 60);
    res.json({ success: true, data, source: "prisma" });
  } catch (err) {
    console.error("Get revenue data error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router10.get("/top-products", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const schema = req.user?.storeSchema || "unknown";
    const cacheKey = `${schema}:dashboard:top-products`;
    const cached = await cacheGet(cacheKey);
    if (cached) return res.json({ success: true, data: cached, source: "cache" });
    const data = await getTopProducts(prisma2);
    await cacheSet(cacheKey, data, 60);
    res.json({ success: true, data });
  } catch (err) {
    console.error("Get top products error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router10.get("/recent-activity", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const data = await getRecentActivity(prisma2);
    res.json({ success: true, data });
  } catch (err) {
    console.error("Get recent activity error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var dashboard_default = router10;

// src/routes/suppliers.ts
var import_express11 = require("express");
var router11 = (0, import_express11.Router)();
router11.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { search, status } = req.query;
    const where = {};
    if (status && status !== "all") where.status = status;
    if (search) {
      const q = String(search);
      where.OR = [
        { name: { contains: q } },
        { code: { contains: q } },
        { contactName: { contains: q } },
        { phone: { contains: q } }
      ];
    }
    const suppliers = await prisma2.supplier.findMany({ where, orderBy: { createdAt: "desc" } });
    res.json({ success: true, data: suppliers });
  } catch (err) {
    console.error("Get suppliers error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router11.get("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const supplier = await prisma2.supplier.findUnique({
      where: { id: String(req.params.id) },
      include: { purchaseOrders: { take: 10, orderBy: { createdAt: "desc" } } }
    });
    if (!supplier) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: supplier });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router11.post("/", authMiddleware, requireRole("admin", "manager"), validate(CreateSupplierSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { name, contactName, phone, email, address, taxCode, status, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: "Name required" });
    const count = await prisma2.supplier.count();
    const code = `NCC-${String(count + 1).padStart(3, "0")}`;
    const supplier = await prisma2.supplier.create({
      data: { code, name: name.trim(), contactName, phone, email, address, taxCode, status: status || "active", notes }
    });
    res.status(201).json({ success: true, data: supplier });
  } catch (err) {
    console.error("Create supplier error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router11.put("/:id", authMiddleware, requireRole("admin", "manager"), validate(UpdateSupplierSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { name, contactName, phone, email, address, taxCode, status, notes } = req.body;
    const supplier = await prisma2.supplier.update({
      where: { id: String(req.params.id) },
      data: { name, contactName, phone, email, address, taxCode, status, notes }
    });
    res.json({ success: true, data: supplier });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router11.delete("/:id", authMiddleware, requireRole("admin", "manager"), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const poCount = await prisma2.purchaseOrder.count({ where: { supplierId: String(req.params.id) } });
    if (poCount > 0) return res.status(400).json({ success: false, error: `Supplier has ${poCount} purchase orders` });
    await prisma2.supplier.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var suppliers_default = router11;

// src/routes/purchaseOrders.ts
var import_express12 = require("express");
var router12 = (0, import_express12.Router)();
router12.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { search, status } = req.query;
    const where = {};
    if (status && status !== "all") where.status = status;
    if (search) {
      const q = String(search);
      where.OR = [
        { code: { contains: q } },
        { supplierName: { contains: q } }
      ];
    }
    const orders = await prisma2.purchaseOrder.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: "desc" }
    });
    res.json({ success: true, data: orders });
  } catch (err) {
    console.error("Get POs error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router12.get("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const po = await prisma2.purchaseOrder.findUnique({
      where: { id: String(req.params.id) },
      include: { items: true, supplier: true }
    });
    if (!po) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: po });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router12.post("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { supplierId, supplierName, items, notes, expectedDate } = req.body;
    if (!supplierName?.trim()) return res.status(400).json({ success: false, error: "Supplier name required" });
    if (!items?.length) return res.status(400).json({ success: false, error: "At least one item required" });
    const count = await prisma2.purchaseOrder.count();
    const code = `PO-${String(count + 1).padStart(3, "0")}`;
    const totalAmount = items.reduce((s, it) => s + (it.quantity || 0) * (it.unitPrice || 0), 0);
    const po = await prisma2.purchaseOrder.create({
      data: {
        code,
        supplierId: supplierId || null,
        supplierName: supplierName.trim(),
        status: "draft",
        totalAmount,
        notes,
        expectedDate: expectedDate ? new Date(expectedDate) : null,
        items: {
          create: items.map((it) => ({
            productName: it.productName,
            sku: it.sku || null,
            quantity: it.quantity || 1,
            unitPrice: it.unitPrice || 0
          }))
        }
      },
      include: { items: true }
    });
    res.status(201).json({ success: true, data: po });
  } catch (err) {
    console.error("Create PO error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router12.put("/:id/status", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { status } = req.body;
    const validStatuses = ["draft", "pending", "confirmed", "shipping", "received", "cancelled"];
    if (!validStatuses.includes(status)) return res.status(400).json({ success: false, error: "Invalid status" });
    const existing = await prisma2.purchaseOrder.findUnique({
      where: { id: String(req.params.id) },
      include: { items: true }
    });
    if (!existing) return res.status(404).json({ success: false, error: "Purchase order not found" });
    const data = { status };
    if (status === "received") data.receivedDate = /* @__PURE__ */ new Date();
    const po = await prisma2.purchaseOrder.update({
      where: { id: String(req.params.id) },
      data,
      include: { items: true }
    });
    if (status === "received" && existing.status !== "received") {
      let updatedCount = 0;
      for (const item of existing.items) {
        let product = null;
        if (item.sku?.trim()) {
          product = await prisma2.product.findFirst({
            where: { sku: { equals: item.sku.trim(), mode: "insensitive" } }
          });
        }
        if (!product && item.productName?.trim()) {
          product = await prisma2.product.findFirst({
            where: { name: { equals: item.productName.trim(), mode: "insensitive" } }
          });
        }
        if (product) {
          await prisma2.product.update({
            where: { id: product.id },
            data: { stock: { increment: item.quantity } }
          });
          updatedCount++;
        } else {
          console.warn(`[PO received] Product not found: SKU=${item.sku} name=${item.productName}`);
        }
      }
      console.log(`[PO received] ${po.code} \u2014 stock updated for ${updatedCount}/${existing.items.length} items`);
    }
    res.json({ success: true, data: po });
  } catch (err) {
    console.error("Update PO status error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router12.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    await prisma2.purchaseOrder.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var purchaseOrders_default = router12;

// src/routes/expenses.ts
var import_express13 = require("express");
var router13 = (0, import_express13.Router)();
router13.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const { search, category } = req.query;
    const where = {};
    if (category && category !== "all") where.category = category;
    if (search) where.description = { contains: String(search) };
    const expenses = await prisma2.expense.findMany({ where, orderBy: { date: "desc" } });
    res.json({ success: true, data: expenses });
  } catch (err) {
    console.error("Get expenses error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router13.get("/stats", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const expenses = await prisma2.expense.findMany({ where: { ...getBranchFilter(req) } });
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    const recurring = expenses.filter((e) => e.recurring).reduce((s, e) => s + e.amount, 0);
    const categories = {};
    expenses.forEach((e) => {
      categories[e.category] = (categories[e.category] || 0) + e.amount;
    });
    res.json({ success: true, data: { total, recurring, count: expenses.length, categories } });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router13.post("/", authMiddleware, requireRole("admin", "manager"), validate(CreateExpenseSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const { description, amount, category, paidBy, recurring, date } = req.body;
    if (!description?.trim()) return res.status(400).json({ success: false, error: "Description required" });
    if (!amount || amount <= 0) return res.status(400).json({ success: false, error: "Valid amount required" });
    const expense = await prisma2.expense.create({
      data: {
        description: description.trim(),
        amount: Number(amount),
        category: category || "other",
        paidBy: paidBy || "Admin",
        recurring: recurring || false,
        date: date ? new Date(date) : /* @__PURE__ */ new Date()
      }
    });
    res.status(201).json({ success: true, data: expense });
  } catch (err) {
    console.error("Create expense error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router13.put("/:id", authMiddleware, requireRole("admin", "manager"), validate(UpdateExpenseSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const expId = String(req.params.id);
    const { description, amount, category, paidBy, recurring, date } = req.body;
    const expense = await prisma2.expense.update({
      where: { id: expId },
      data: {
        ...description !== void 0 && { description },
        ...amount !== void 0 && { amount: Number(amount) },
        ...category !== void 0 && { category },
        ...paidBy !== void 0 && { paidBy },
        ...recurring !== void 0 && { recurring },
        ...date !== void 0 && { date: new Date(date) }
      }
    });
    res.json({ success: true, data: expense });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router13.delete("/:id", authMiddleware, requireRole("admin", "manager"), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    await prisma2.expense.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var expenses_default = router13;

// src/routes/employees.ts
var import_express14 = require("express");
var import_bcryptjs3 = __toESM(require("bcryptjs"));
var router14 = (0, import_express14.Router)();
var safeUser = (u) => {
  const { password, ...rest } = u;
  return rest;
};
var DEPARTMENT_ROLES = {
  office: ["admin", "manager", "accountant"],
  sales: ["sales", "cashier"],
  delivery: ["driver", "shipper"]
};
router14.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { search, role, status, department } = req.query;
    const where = { ...getBranchFilter(req) };
    if (department && DEPARTMENT_ROLES[String(department)]) {
      where.role = { in: DEPARTMENT_ROLES[String(department)] };
    } else if (role && role !== "all") {
      where.role = String(role);
    }
    if (status && status !== "all") where.employeeStatus = status;
    if (search) {
      const q = String(search);
      where.OR = [
        { name: { contains: q } },
        { code: { contains: q } },
        { phone: { contains: q } },
        { email: { contains: q } }
      ];
    }
    const users = await prisma2.user.findMany({ where, orderBy: { createdAt: "desc" }, include: { branch: { select: { id: true, name: true, code: true, isMainBranch: true } } } });
    res.json({ success: true, data: users.map((u) => {
      const { password, ...rest } = u;
      return rest;
    }) });
  } catch (err) {
    console.error("Get employees error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router14.get("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const user = await prisma2.user.findFirst({ where: { id: String(req.params.id) }, include: { branch: { select: { id: true, name: true, code: true, isMainBranch: true } } } });
    if (!user) return res.status(404).json({ success: false, error: "Not found" });
    const { password, ...rest } = user;
    res.json({ success: true, data: rest });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router14.post("/", authMiddleware, requireRole("admin", "manager"), validate(CreateEmployeeSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { name, phone, email, role, salary, notes, branchId: assignBranchId } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: "Name required" });
    if (!phone?.trim()) return res.status(400).json({ success: false, error: "Phone required" });
    const effectiveBranchId = assignBranchId || getBranchId(req);
    const count = await prisma2.user.count({ where: {} });
    const code = `NV-${String(count + 1).padStart(3, "0")}`;
    const emailVal = email?.trim() || `${code.toLowerCase().replace("-", ".")}@kengitech.vn`;
    const existing = await prisma2.user.findFirst({ where: { email: emailVal } });
    if (existing) return res.status(400).json({ success: false, error: "Email already exists" });
    const hashedPassword = await import_bcryptjs3.default.hash("123456", 10);
    const user = await prisma2.user.create({
      data: {
        name: name.trim(),
        email: emailVal,
        password: hashedPassword,
        role: role || "cashier",
        phone: phone?.trim(),
        code,
        salary: salary ? Number(salary) : null,
        hireDate: /* @__PURE__ */ new Date(),
        employeeStatus: "active",
        notes: notes?.trim() || null,
        branchId: effectiveBranchId || null
      }
    });
    res.status(201).json({ success: true, data: safeUser(user) });
  } catch (err) {
    console.error("Create employee error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router14.put("/:id", authMiddleware, requireRole("admin", "manager"), validate(UpdateEmployeeSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { name, phone, email, role, salary, notes, employeeStatus, branchId: newBranchId } = req.body;
    const empId = String(req.params.id);
    const target = await prisma2.user.findFirst({ where: { id: empId } });
    if (!target) return res.status(404).json({ success: false, error: "Not found" });
    const currentUser = req.user;
    if (target.role === "admin" && currentUser.role !== "admin") {
      return res.status(403).json({ success: false, error: "Kh\xF4ng th\u1EC3 s\u1EEDa t\xE0i kho\u1EA3n admin" });
    }
    if (role === "admin" && currentUser.role !== "admin") {
      return res.status(403).json({ success: false, error: "Ch\u1EC9 admin m\u1EDBi \u0111\u01B0\u1EE3c g\xE1n quy\u1EC1n admin" });
    }
    const data = {};
    if (name !== void 0) data.name = name;
    if (phone !== void 0) data.phone = phone;
    if (email !== void 0) data.email = email;
    if (role !== void 0) data.role = role;
    if (salary !== void 0) data.salary = Number(salary);
    if (notes !== void 0) data.notes = notes;
    if (employeeStatus !== void 0) data.employeeStatus = employeeStatus;
    if (newBranchId !== void 0) data.branchId = newBranchId || null;
    const user = await prisma2.user.update({ where: { id: empId }, data, include: { branch: { select: { id: true, name: true, code: true, isMainBranch: true } } } });
    const { password: _, ...rest } = user;
    res.json({ success: true, data: rest });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router14.put("/:id/toggle-status", authMiddleware, requireRole("admin", "manager"), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const user = await prisma2.user.findFirst({ where: { id: String(req.params.id) } });
    if (!user) return res.status(404).json({ success: false, error: "Not found" });
    const updated = await prisma2.user.update({
      where: { id: String(req.params.id) },
      data: { employeeStatus: user.employeeStatus === "active" ? "inactive" : "active" }
    });
    res.json({ success: true, data: safeUser(updated) });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router14.delete("/:id", authMiddleware, requireRole("admin"), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const target = await prisma2.user.findFirst({ where: { id: String(req.params.id) } });
    if (!target) return res.status(404).json({ success: false, error: "Not found" });
    const txCount = await prisma2.transaction.count({ where: { createdBy: String(req.params.id) } });
    if (txCount > 0) {
      return res.status(400).json({ success: false, error: `Employee has ${txCount} transactions, cannot delete. Deactivate instead.` });
    }
    await prisma2.user.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var employees_default = router14;

// src/routes/notifications.ts
var import_express15 = require("express");
var router15 = (0, import_express15.Router)();
var clients = /* @__PURE__ */ new Map();
router15.get("/stream", authMiddleware, (req, res) => {
  const storeId = req.storeId || req.user?.storeSchema || "default";
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*"
  });
  const client = { res, storeId };
  if (!clients.has(storeId)) clients.set(storeId, /* @__PURE__ */ new Set());
  clients.get(storeId).add(client);
  res.write('event: connected\ndata: {"status":"ok"}\n\n');
  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 25e3);
  req.on("close", () => {
    clearInterval(heartbeat);
    clients.get(storeId)?.delete(client);
  });
});
router15.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const lowStock = await prisma2.product.findMany({
      where: { stock: { lte: 5 }, productType: { not: "service" } },
      select: { id: true, name: true, stock: true, sku: true },
      orderBy: { stock: "asc" },
      take: 20
    });
    const notifications = lowStock.map((p) => ({
      id: `low-${p.id}`,
      type: "low_stock",
      title: "S\u1EAFp h\u1EBFt h\xE0ng",
      message: `${p.name} c\xF2n ${p.stock} s\u1EA3n ph\u1EA9m (SKU: ${p.sku})`,
      productId: p.id,
      severity: p.stock === 0 ? "critical" : "warning",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    }));
    res.json({ success: true, data: notifications, count: notifications.length });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var notifications_default = router15;

// src/routes/warranties.ts
var import_express16 = require("express");
var router16 = (0, import_express16.Router)();
router16.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { search, status } = req.query;
    const where = {};
    if (status && status !== "all") where.status = String(status);
    if (search) {
      const q = String(search);
      where.OR = [{ productName: { contains: q } }, { customerName: { contains: q } }, { code: { contains: q } }, { serialNumber: { contains: q } }];
    }
    const data = await prisma2.warranty.findMany({ where, orderBy: { createdAt: "desc" } });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router16.post("/", authMiddleware, validate(CreateWarrantySchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { productName, customerName, customerPhone, serialNumber, startDate, endDate, notes, productId } = req.body;
    if (!productName?.trim() || !customerName?.trim()) return res.status(400).json({ success: false, error: "Product and customer name required" });
    const count = await prisma2.warranty.count();
    const code = `WR-${String(count + 1).padStart(4, "0")}`;
    const data = await prisma2.warranty.create({
      data: { code, productId, productName, customerName, customerPhone, serialNumber, startDate: new Date(startDate), endDate: new Date(endDate), notes }
    });
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router16.put("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { status, notes, endDate } = req.body;
    const data = await prisma2.warranty.update({ where: { id: String(req.params.id) }, data: { ...status && { status }, ...notes !== void 0 && { notes }, ...endDate && { endDate: new Date(endDate) } } });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router16.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    await prisma2.warranty.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var warranties_default = router16;

// src/routes/repairs.ts
var import_express17 = require("express");
var router17 = (0, import_express17.Router)();
router17.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { search, status } = req.query;
    const where = {};
    if (status && status !== "all") where.status = status;
    if (search) {
      const q = String(search);
      where.OR = [{ productName: { contains: q } }, { customerName: { contains: q } }, { code: { contains: q } }];
    }
    const data = await prisma2.repair.findMany({ where, orderBy: { createdAt: "desc" } });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router17.post("/", authMiddleware, validate(CreateRepairSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { productName, customerName, customerPhone, issue, cost, estimatedDate, notes } = req.body;
    if (!productName?.trim() || !issue?.trim()) return res.status(400).json({ success: false, error: "Product name and issue required" });
    const count = await prisma2.repair.count();
    const code = `RP-${String(count + 1).padStart(4, "0")}`;
    const data = await prisma2.repair.create({
      data: { code, productName, customerName: customerName || "", customerPhone, issue, cost: Number(cost) || 0, estimatedDate: estimatedDate ? new Date(estimatedDate) : null, notes }
    });
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router17.put("/:id", authMiddleware, validate(UpdateRepairSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { status, cost, notes, completedDate } = req.body;
    const data = {};
    if (status) data.status = status;
    if (cost !== void 0) data.cost = Number(cost);
    if (notes !== void 0) data.notes = notes;
    if (status === "done" || completedDate) data.completedDate = /* @__PURE__ */ new Date();
    const result = await prisma2.repair.update({ where: { id: String(req.params.id) }, data });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router17.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    await prisma2.repair.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var repairs_default = router17;

// src/routes/quotations.ts
var import_express18 = require("express");
var router18 = (0, import_express18.Router)();
router18.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { search, status } = req.query;
    const where = {};
    if (status && status !== "all") where.status = status;
    if (search) {
      const q = String(search);
      where.OR = [{ code: { contains: q } }, { customerName: { contains: q } }];
    }
    const data = await prisma2.quotation.findMany({ where, orderBy: { createdAt: "desc" } });
    const parsed = data.map((q) => ({ ...q, items: JSON.parse(q.items || "[]") }));
    res.json({ success: true, data: parsed });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router18.post("/", authMiddleware, validate(CreateQuotationSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { customerName, customerPhone, items, totalAmount, validUntil, notes } = req.body;
    if (!customerName?.trim()) return res.status(400).json({ success: false, error: "Customer name required" });
    const count = await prisma2.quotation.count();
    const code = `QT-${String(count + 1).padStart(4, "0")}`;
    const data = await prisma2.quotation.create({
      data: { code, customerName, customerPhone, items: JSON.stringify(items || []), totalAmount: Number(totalAmount) || 0, validUntil: validUntil ? new Date(validUntil) : null, notes }
    });
    res.status(201).json({ success: true, data: { ...data, items: JSON.parse(data.items) } });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router18.put("/:id", authMiddleware, validate(UpdateQuotationSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { status, customerName, items, totalAmount, notes } = req.body;
    const qId = String(req.params.id);
    const d = {};
    if (status) d.status = status;
    if (customerName) d.customerName = customerName;
    if (items) {
      d.items = JSON.stringify(items);
      d.totalAmount = items.reduce((s, it) => s + (it.quantity || 0) * (it.unitPrice || 0), 0);
    }
    if (totalAmount !== void 0) d.totalAmount = Number(totalAmount);
    if (notes !== void 0) d.notes = notes;
    const data = await prisma2.quotation.update({ where: { id: qId }, data: d });
    res.json({ success: true, data: { ...data, items: JSON.parse(data.items) } });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router18.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    await prisma2.quotation.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var quotations_default = router18;

// src/routes/auditLogs.ts
var import_express19 = require("express");
var router19 = (0, import_express19.Router)();
router19.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { search, action, entity } = req.query;
    const where = {};
    if (action && action !== "all") where.action = action;
    if (entity && entity !== "all") where.entity = entity;
    if (search) {
      const q = String(search);
      where.OR = [
        { userName: { contains: q } },
        { details: { contains: q } },
        { entity: { contains: q } }
      ];
    }
    const data = await prisma2.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router19.post("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { userId, userName, action, entity, entityId, details, ipAddress } = req.body;
    const data = await prisma2.auditLog.create({
      data: { userId, userName, action, entity, entityId, details, ipAddress }
    });
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var auditLogs_default = router19;

// src/routes/priceHistory.ts
var import_express20 = require("express");
var router20 = (0, import_express20.Router)();
router20.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { productId, search } = req.query;
    const where = {};
    if (productId) where.productId = productId;
    if (search) {
      const q = String(search);
      where.OR = [{ productName: { contains: q } }, { productSku: { contains: q } }];
    }
    const data = await prisma2.priceHistory.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router20.post("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { productId, productName, productSku, oldPrice, newPrice, changedBy, reason } = req.body;
    const data = await prisma2.priceHistory.create({ data: { productId, productName, productSku, oldPrice: Number(oldPrice), newPrice: Number(newPrice), changedBy, reason } });
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var priceHistory_default = router20;

// src/routes/shipping.ts
var import_express21 = require("express");
var router21 = (0, import_express21.Router)();
router21.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const { search, status } = req.query;
    const where = {};
    if (status && status !== "all") where.status = status;
    if (search) {
      const q = String(search);
      where.OR = [{ code: { contains: q } }, { customerName: { contains: q } }, { address: { contains: q } }];
    }
    const data = await prisma2.shippingOrder.findMany({ where, orderBy: { createdAt: "desc" } });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router21.post("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const { transactionId, customerName, customerPhone, address, driverId, driverName, shippingFee, cod, estimatedDate, notes } = req.body;
    if (!customerName?.trim() || !address?.trim()) return res.status(400).json({ success: false, error: "Customer name and address required" });
    const count = await prisma2.shippingOrder.count();
    const code = `SH-${String(count + 1).padStart(4, "0")}`;
    const data = await prisma2.shippingOrder.create({
      data: { code, transactionId, customerName, customerPhone, address, driverId, driverName, shippingFee: Number(shippingFee) || 0, cod: Number(cod) || 0, estimatedDate: estimatedDate ? new Date(estimatedDate) : null, notes }
    });
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router21.put("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const { status, driverId, driverName, notes } = req.body;
    const d = {};
    if (status) {
      d.status = status;
      if (status === "delivered") d.deliveredDate = /* @__PURE__ */ new Date();
    }
    if (driverId !== void 0) d.driverId = driverId;
    if (driverName !== void 0) d.driverName = driverName;
    if (notes !== void 0) d.notes = notes;
    const data = await prisma2.shippingOrder.update({ where: { id: String(req.params.id) }, data: d });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router21.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    await prisma2.shippingOrder.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var shipping_default = router21;

// src/routes/drivers.ts
var import_express22 = require("express");
var router22 = (0, import_express22.Router)();
router22.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { search, status } = req.query;
    const where = {};
    if (status && status !== "all") where.status = status;
    if (search) {
      const q = String(search);
      where.OR = [{ name: { contains: q } }, { code: { contains: q } }, { phone: { contains: q } }];
    }
    const data = await prisma2.driver.findMany({ where, orderBy: { createdAt: "desc" } });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router22.post("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { name, phone, vehicleType, vehiclePlate, licensePlate, notes } = req.body;
    if (!name?.trim() || !phone?.trim()) return res.status(400).json({ success: false, error: "Name and phone required" });
    const count = await prisma2.driver.count({ where: {} });
    const code = `TX-${String(count + 1).padStart(3, "0")}`;
    const plate = vehiclePlate || licensePlate || null;
    const data = await prisma2.driver.create({ data: { code, name, phone, vehicleType, vehiclePlate: plate, notes, status: "available" } });
    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error("Create driver error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router22.put("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { name, phone, vehicleType, vehiclePlate, licensePlate, status, notes } = req.body;
    const d = {};
    if (name) d.name = name;
    if (phone) d.phone = phone;
    if (vehicleType) d.vehicleType = vehicleType;
    if (vehiclePlate !== void 0 || licensePlate !== void 0) d.vehiclePlate = vehiclePlate || licensePlate;
    if (status) d.status = status;
    if (notes !== void 0) d.notes = notes;
    const data = await prisma2.driver.update({ where: { id: String(req.params.id) }, data: d });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router22.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    await prisma2.driver.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var drivers_default = router22;

// src/routes/tax.ts
var import_express23 = require("express");
var router23 = (0, import_express23.Router)();
router23.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const data = await prisma2.taxConfig.findMany({ where: { ...getBranchFilter(req) } });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router23.post("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { name, rate, description, isDefault } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: "Name required" });
    if (isDefault) await prisma2.taxConfig.updateMany({ data: { isDefault: false } });
    const data = await prisma2.taxConfig.create({ data: { name, rate: Number(rate) || 0, description, isDefault: isDefault || false } });
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router23.put("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { name, rate, description, isDefault, status } = req.body;
    if (isDefault) await prisma2.taxConfig.updateMany({ data: { isDefault: false } });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await prisma2.taxConfig.update({ where: { id }, data: { ...name && { name }, ...rate !== void 0 && { rate: Number(rate) }, ...description !== void 0 && { description }, ...isDefault !== void 0 && { isDefault }, ...status && { status } } });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router23.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await prisma2.taxConfig.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router23.get("/store-info", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const store = await prisma2.store.findFirst();
    if (!store) return res.json({ success: true, data: null });
    res.json({
      success: true,
      data: {
        id: store.id,
        name: store.name,
        address: store.address,
        phone: store.phone,
        email: store.email,
        website: store.website,
        businessType: store.businessType,
        taxCode: store.taxCode,
        ownerName: store.ownerName,
        ownerIdNumber: store.ownerIdNumber,
        representativeName: store.representativeName
      }
    });
  } catch (err) {
    console.error("GET /store-info error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router23.put("/store-info", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { name, address, phone, email, website, businessType, taxCode, ownerName, ownerIdNumber, representativeName } = req.body;
    const store = await prisma2.store.findFirst();
    if (!store) return res.status(404).json({ success: false, error: "Store not found" });
    const data = await prisma2.store.update({
      where: { id: store.id },
      data: {
        ...name !== void 0 && { name },
        ...address !== void 0 && { address },
        ...phone !== void 0 && { phone },
        ...email !== void 0 && { email },
        ...website !== void 0 && { website },
        ...businessType !== void 0 && { businessType },
        ...taxCode !== void 0 && { taxCode },
        ...ownerName !== void 0 && { ownerName },
        ...ownerIdNumber !== void 0 && { ownerIdNumber },
        ...representativeName !== void 0 && { representativeName }
      }
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error("PUT /store-info error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router23.get("/revenue-check", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const year = Number(req.query.year) || (/* @__PURE__ */ new Date()).getFullYear();
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31, 23, 59, 59, 999);
    const transactions = await prisma2.transaction.findMany({
      where: { status: "completed", createdAt: { gte: startDate, lte: endDate } },
      select: { total: true }
    });
    const totalRevenue = transactions.reduce((s, t) => s + (t.total || 0), 0);
    const threshold = 5e8;
    res.json({
      success: true,
      data: { totalRevenue, threshold, isAboveThreshold: totalRevenue >= threshold, year }
    });
  } catch (err) {
    console.error("GET /revenue-check error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router23.get("/invoices", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const year = Number(req.query.year) || (/* @__PURE__ */ new Date()).getFullYear();
    const month = req.query.month ? Number(req.query.month) : void 0;
    const vatOnly = req.query.vatOnly === "true";
    let startDate, endDate;
    if (month) {
      startDate = new Date(year, month - 1, 1);
      endDate = new Date(year, month, 0, 23, 59, 59, 999);
    } else {
      startDate = new Date(year, 0, 1);
      endDate = new Date(year, 11, 31, 23, 59, 59, 999);
    }
    const where = {
      status: "completed",
      createdAt: { gte: startDate, lte: endDate }
    };
    if (vatOnly) {
      where.vatStatus = "issued";
    }
    const transactions = await prisma2.transaction.findMany({
      where,
      select: {
        id: true,
        receiptNumber: true,
        customerName: true,
        customerPhone: true,
        subtotal: true,
        tax: true,
        total: true,
        discount: true,
        vatInvoiceNumber: true,
        vatIssuedAt: true,
        vatStatus: true,
        createdAt: true,
        transactionDate: true
      },
      orderBy: { createdAt: "desc" }
    });
    const summary = {
      count: transactions.length,
      totalRevenue: transactions.reduce((s, t) => s + (t.total || 0), 0),
      totalTax: transactions.reduce((s, t) => s + (t.tax || 0), 0),
      totalSubtotal: transactions.reduce((s, t) => s + (t.subtotal || 0), 0)
    };
    res.json({ success: true, data: transactions, summary });
  } catch (err) {
    console.error("GET /invoices error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
function getPeriodDateRange(periodType, year, month, quarter) {
  let startDate, endDate;
  if (periodType === "quarter" && quarter) {
    const startMonth = (quarter - 1) * 3;
    startDate = new Date(year, startMonth, 1);
    endDate = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);
  } else {
    const m = (month || 1) - 1;
    startDate = new Date(year, m, 1);
    endDate = new Date(year, m + 1, 0, 23, 59, 59, 999);
  }
  return { startDate, endDate };
}
async function calculate01GTGT(prisma2, req, periodType, year, month, quarter) {
  const { startDate, endDate } = getPeriodDateRange(periodType, year, month, quarter);
  const transactions = await prisma2.transaction.findMany({
    where: { status: "completed", createdAt: { gte: startDate, lte: endDate } },
    select: { subtotal: true, tax: true, total: true, discount: true }
  });
  const imports = await prisma2.importReceipt.findMany({
    where: { status: "completed", createdAt: { gte: startDate, lte: endDate } },
    select: { totalCost: true }
  });
  const taxConfigs = await prisma2.taxConfig.findMany({ where: { ...getBranchFilter(req), status: "active" } });
  const defaultRate = taxConfigs.find((t) => t.isDefault)?.rate ?? 10;
  const totalSalesSubtotal = transactions.reduce((s, t) => s + (t.subtotal || 0), 0);
  const totalSalesTax = transactions.reduce((s, t) => s + (t.tax || 0), 0);
  let ct21 = 0, ct22 = 0, ct23 = 0, ct24 = 0, ct25 = 0, ct26 = 0, ct27 = 0, ct28 = 0;
  if (defaultRate === 0) {
    ct22 = totalSalesSubtotal;
  } else if (defaultRate === 5) {
    ct23 = totalSalesSubtotal;
    ct24 = totalSalesTax;
  } else if (defaultRate === 8) {
    ct25 = totalSalesSubtotal;
    ct26 = totalSalesTax;
  } else {
    ct27 = totalSalesSubtotal;
    ct28 = totalSalesTax;
  }
  const ct29 = ct21 + ct22 + ct23 + ct25 + ct27;
  const ct30 = ct24 + ct26 + ct28;
  const totalImportCost = imports.reduce((s, i) => s + (i.totalCost || 0), 0);
  const ct31 = totalImportCost;
  const ct32 = totalImportCost * (defaultRate / 100);
  const ct33 = ct32;
  const ct34 = 0;
  const ct35 = ct30 - ct33 - ct34;
  const ct36 = 0, ct37 = 0;
  const ct38 = ct35 > 0 ? ct35 + ct36 - ct37 : 0;
  const ct39 = ct35 < 0 ? Math.abs(ct35) - ct36 + ct37 : 0;
  const ct40a = 0;
  const ct40b = ct39 - ct40a;
  return { ct21, ct22, ct23, ct24, ct25, ct26, ct27, ct28, ct29, ct30, ct31, ct32, ct33, ct34, ct35, ct36, ct37, ct38, ct39, ct40a, ct40b };
}
async function calculate01CNKD(prisma2, periodType, year, month, quarter) {
  const { startDate, endDate } = getPeriodDateRange(periodType, year, month, quarter);
  const transactions = await prisma2.transaction.findMany({
    where: { status: "completed", createdAt: { gte: startDate, lte: endDate } },
    select: { total: true }
  });
  const cnkdRevenue = transactions.reduce((s, t) => s + (t.total || 0), 0);
  const cnkdVatRate = 1;
  const cnkdPitRate = 0.5;
  const cnkdThreshold = 5e8;
  const monthsInPeriod = periodType === "quarter" ? 3 : 1;
  const annualizedRevenue = cnkdRevenue * (12 / monthsInPeriod);
  const isAboveThreshold = annualizedRevenue > cnkdThreshold;
  const cnkdVatAmount = isAboveThreshold ? cnkdRevenue * (cnkdVatRate / 100) : 0;
  const cnkdPitAmount = isAboveThreshold ? cnkdRevenue * (cnkdPitRate / 100) : 0;
  const cnkdTotalTax = cnkdVatAmount + cnkdPitAmount;
  return { cnkdRevenue, cnkdVatRate, cnkdVatAmount, cnkdPitRate, cnkdPitAmount, cnkdTotalTax, cnkdThreshold };
}
function escXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function build01GTGT_Xml(decl) {
  const pad2 = (n) => String(n).padStart(2, "0");
  const now = /* @__PURE__ */ new Date();
  const ngayLap = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${now.getFullYear()}`;
  const fmtNum = (v) => Math.round(v);
  return `<?xml version="1.0" encoding="UTF-8"?>
<HSoThueDTu>
  <HSoKhaiThue>
    <TTChung>
      <ma_nd>01/GTGT</ma_nd>
      <ten_nd>T\u1EDC KHAI THU\u1EBE GI\xC1 TR\u1ECA GIA T\u0102NG (M\u1EABu s\u1ED1 01/GTGT)</ten_nd>
      <mso_thue>${escXml(decl.taxCode)}</mso_thue>
      <ten_NNT>${escXml(decl.companyName)}</ten_NNT>
      <dchi_NNT>${escXml(decl.companyAddress || "")}</dchi_NNT>
      <ky_khai>${escXml(decl.period)}</ky_khai>
      <ky_khai_loai>${decl.periodType === "month" ? "T" : "Q"}</ky_khai_loai>
      <ky_khai_nam>${decl.year}</ky_khai_nam>
      ${decl.month ? `<ky_khai_thang>${pad2(decl.month)}</ky_khai_thang>` : ""}
      ${decl.quarter ? `<ky_khai_quy>${decl.quarter}</ky_khai_quy>` : ""}
      <ngay_lap>${ngayLap}</ngay_lap>
      <lan_nop>1</lan_nop>
      <bo_sung>0</bo_sung>
    </TTChung>
    <CTieuTKhai>
      <ct21>${fmtNum(decl.ct21)}</ct21>
      <ct22>${fmtNum(decl.ct22)}</ct22>
      <ct23>${fmtNum(decl.ct23)}</ct23>
      <ct24>${fmtNum(decl.ct24)}</ct24>
      <ct25>${fmtNum(decl.ct25)}</ct25>
      <ct26>${fmtNum(decl.ct26)}</ct26>
      <ct27>${fmtNum(decl.ct27)}</ct27>
      <ct28>${fmtNum(decl.ct28)}</ct28>
      <ct29>${fmtNum(decl.ct29)}</ct29>
      <ct30>${fmtNum(decl.ct30)}</ct30>
      <ct31>${fmtNum(decl.ct31)}</ct31>
      <ct32>${fmtNum(decl.ct32)}</ct32>
      <ct33>${fmtNum(decl.ct33)}</ct33>
      <ct34>${fmtNum(decl.ct34)}</ct34>
      <ct35>${fmtNum(decl.ct35)}</ct35>
      <ct36>${fmtNum(decl.ct36)}</ct36>
      <ct37>${fmtNum(decl.ct37)}</ct37>
      <ct38>${fmtNum(decl.ct38)}</ct38>
      <ct39>${fmtNum(decl.ct39)}</ct39>
      <ct40a>${fmtNum(decl.ct40a)}</ct40a>
      <ct40b>${fmtNum(decl.ct40b)}</ct40b>
    </CTieuTKhai>
  </HSoKhaiThue>
</HSoThueDTu>`;
}
function build01CNKD_Xml(decl) {
  const pad2 = (n) => String(n).padStart(2, "0");
  const now = /* @__PURE__ */ new Date();
  const ngayLap = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${now.getFullYear()}`;
  const fmtNum = (v) => Math.round(v);
  return `<?xml version="1.0" encoding="UTF-8"?>
<HSoThueDTu>
  <HSoKhaiThue>
    <TTChung>
      <ma_nd>01/CNKD</ma_nd>
      <ten_nd>T\u1EDC KHAI THU\u1EBE \u0110\u1ED0I V\u1EDAI C\xC1 NH\xC2N KINH DOANH (M\u1EABu s\u1ED1 01/CNKD)</ten_nd>
      <mso_thue>${escXml(decl.taxCode)}</mso_thue>
      <ten_NNT>${escXml(decl.companyName)}</ten_NNT>
      <dchi_NNT>${escXml(decl.companyAddress || "")}</dchi_NNT>
      <loai_hinh>${decl.businessType === "household" ? "HKD" : "CNKD"}</loai_hinh>
      <ky_khai>${escXml(decl.period)}</ky_khai>
      <ky_khai_loai>${decl.periodType === "month" ? "T" : "Q"}</ky_khai_loai>
      <ky_khai_nam>${decl.year}</ky_khai_nam>
      ${decl.month ? `<ky_khai_thang>${pad2(decl.month)}</ky_khai_thang>` : ""}
      ${decl.quarter ? `<ky_khai_quy>${decl.quarter}</ky_khai_quy>` : ""}
      <ngay_lap>${ngayLap}</ngay_lap>
      <lan_nop>1</lan_nop>
      <bo_sung>0</bo_sung>
    </TTChung>
    <CTieuTKhai>
      <nganh_nghe>Ban le</nganh_nghe>
      <doanh_thu>${fmtNum(decl.cnkdRevenue)}</doanh_thu>
      <nguong_chiu_thue>${fmtNum(decl.cnkdThreshold)}</nguong_chiu_thue>
      <ty_le_thue_gtgt>${decl.cnkdVatRate}</ty_le_thue_gtgt>
      <thue_gtgt>${fmtNum(decl.cnkdVatAmount)}</thue_gtgt>
      <ty_le_thue_tncn>${decl.cnkdPitRate}</ty_le_thue_tncn>
      <thue_tncn>${fmtNum(decl.cnkdPitAmount)}</thue_tncn>
      <tong_thue>${fmtNum(decl.cnkdTotalTax)}</tong_thue>
    </CTieuTKhai>
  </HSoKhaiThue>
</HSoThueDTu>`;
}
router23.get("/declarations", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const data = await prisma2.taxDeclaration.findMany({ orderBy: { createdAt: "desc" } });
    res.json({ success: true, data });
  } catch (err) {
    console.error("GET /declarations error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router23.post("/declarations", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { periodType = "month", taxCode, companyName, companyAddress, transactionIds } = req.body;
    const year = Number(req.body.year);
    const month = req.body.month ? Number(req.body.month) : void 0;
    const quarter = req.body.quarter ? Number(req.body.quarter) : void 0;
    if (!year || !taxCode || !companyName) {
      return res.status(400).json({ success: false, error: "year, taxCode, companyName required" });
    }
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);
    const allYearTx = await prisma2.transaction.findMany({
      where: { status: "completed", createdAt: { gte: yearStart, lte: yearEnd } },
      select: { total: true }
    });
    const annualRevenue = allYearTx.reduce((s, t) => s + (t.total || 0), 0);
    const isAboveThreshold = annualRevenue >= 5e8;
    const formType = isAboveThreshold ? "01_GTGT" : "01_CNKD";
    const businessType = isAboveThreshold ? "company" : "household";
    const period = periodType === "quarter" ? `Q${quarter}/${year}` : `T${String(month).padStart(2, "0")}/${year}`;
    console.log(`Creating declaration: form=${formType}, revenue=${annualRevenue}, period=${period}, selectedIds=${transactionIds?.length || "all"}`);
    let calculated = {};
    if (transactionIds && transactionIds.length > 0) {
      const selectedTx = await prisma2.transaction.findMany({
        where: { id: { in: transactionIds }, status: "completed" },
        select: { subtotal: true, tax: true, total: true, discount: true }
      });
      if (formType === "01_GTGT") {
        const taxConfigs = await prisma2.taxConfig.findMany({ where: { ...getBranchFilter(req), status: "active" } });
        const defaultRate = taxConfigs.find((t) => t.isDefault)?.rate ?? 10;
        const totalSubtotal = selectedTx.reduce((s, t) => s + (t.subtotal || 0), 0);
        const totalTax = selectedTx.reduce((s, t) => s + (t.tax || 0), 0);
        let ct21 = 0, ct22 = 0, ct23 = 0, ct24 = 0, ct25 = 0, ct26 = 0, ct27 = 0, ct28 = 0;
        if (defaultRate === 0) {
          ct22 = totalSubtotal;
        } else if (defaultRate === 5) {
          ct23 = totalSubtotal;
          ct24 = totalTax;
        } else if (defaultRate === 8) {
          ct25 = totalSubtotal;
          ct26 = totalTax;
        } else {
          ct27 = totalSubtotal;
          ct28 = totalTax;
        }
        const ct29 = ct21 + ct22 + ct23 + ct25 + ct27;
        const ct30 = ct24 + ct26 + ct28;
        const { startDate, endDate } = getPeriodDateRange(periodType, year, month, quarter);
        const imports = await prisma2.importReceipt.findMany({
          where: { status: "completed", createdAt: { gte: startDate, lte: endDate } },
          select: { totalCost: true }
        });
        const totalImportCost = imports.reduce((s, i) => s + (i.totalCost || 0), 0);
        const ct31 = totalImportCost, ct32 = totalImportCost * (defaultRate / 100), ct33 = ct32;
        const ct34 = 0, ct35 = ct30 - ct33 - ct34;
        const ct36 = 0, ct37 = 0;
        const ct38 = ct35 > 0 ? ct35 + ct36 - ct37 : 0;
        const ct39 = ct35 < 0 ? Math.abs(ct35) - ct36 + ct37 : 0;
        const ct40a = 0, ct40b = ct39 - ct40a;
        calculated = { ct21, ct22, ct23, ct24, ct25, ct26, ct27, ct28, ct29, ct30, ct31, ct32, ct33, ct34, ct35, ct36, ct37, ct38, ct39, ct40a, ct40b };
      } else {
        const cnkdRevenue = selectedTx.reduce((s, t) => s + (t.total || 0), 0);
        const cnkdVatRate = 1, cnkdPitRate = 0.5;
        const cnkdVatAmount = cnkdRevenue * (cnkdVatRate / 100);
        const cnkdPitAmount = cnkdRevenue * (cnkdPitRate / 100);
        const cnkdTotalTax = cnkdVatAmount + cnkdPitAmount;
        calculated = { cnkdRevenue, cnkdVatRate, cnkdVatAmount, cnkdPitRate, cnkdPitAmount, cnkdTotalTax, cnkdThreshold: 5e8 };
      }
    } else {
      if (formType === "01_GTGT") {
        calculated = await calculate01GTGT(prisma2, req, periodType, year, month, quarter);
      } else {
        calculated = await calculate01CNKD(prisma2, periodType, year, month, quarter);
      }
    }
    console.log("Calculated:", JSON.stringify(calculated));
    const data = await prisma2.taxDeclaration.create({
      data: {
        formType,
        businessType,
        period,
        periodType,
        year,
        month: periodType === "month" ? month || null : null,
        quarter: periodType === "quarter" ? quarter || null : null,
        taxCode,
        companyName,
        companyAddress: companyAddress || null,
        ...calculated
      }
    });
    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error("POST /declarations error:", err);
    res.status(500).json({ success: false, error: err?.message || "Internal server error" });
  }
});
router23.put("/declarations/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { status, notes, filedAt, ...fields } = req.body;
    const updateData = {};
    if (status) updateData.status = status;
    if (notes !== void 0) updateData.notes = notes;
    if (filedAt) updateData.filedAt = new Date(filedAt);
    const allowedFields = [
      "ct21",
      "ct22",
      "ct23",
      "ct24",
      "ct25",
      "ct26",
      "ct27",
      "ct28",
      "ct31",
      "ct32",
      "ct33",
      "ct34",
      "ct36",
      "ct37",
      "ct40a",
      "cnkdRevenue",
      "cnkdVatRate",
      "cnkdPitRate"
    ];
    for (const f of allowedFields) {
      if (fields[f] !== void 0) updateData[f] = Number(fields[f]);
    }
    if (Object.keys(updateData).some((k) => k.startsWith("ct"))) {
      const existing = await prisma2.taxDeclaration.findUnique({ where: { id } });
      if (existing) {
        const merged = { ...existing, ...updateData };
        merged.ct29 = merged.ct21 + merged.ct22 + merged.ct23 + merged.ct25 + merged.ct27;
        merged.ct30 = merged.ct24 + merged.ct26 + merged.ct28;
        merged.ct35 = merged.ct30 - merged.ct33 - merged.ct34;
        merged.ct38 = merged.ct35 > 0 ? merged.ct35 + merged.ct36 - merged.ct37 : 0;
        merged.ct39 = merged.ct35 < 0 ? Math.abs(merged.ct35) - merged.ct36 + merged.ct37 : 0;
        merged.ct40b = merged.ct39 - merged.ct40a;
        updateData.ct29 = merged.ct29;
        updateData.ct30 = merged.ct30;
        updateData.ct35 = merged.ct35;
        updateData.ct38 = merged.ct38;
        updateData.ct39 = merged.ct39;
        updateData.ct40b = merged.ct40b;
      }
    }
    if (Object.keys(updateData).some((k) => k.startsWith("cnkd"))) {
      const existing = await prisma2.taxDeclaration.findUnique({ where: { id } });
      if (existing) {
        const merged = { ...existing, ...updateData };
        merged.cnkdVatAmount = merged.cnkdRevenue * (merged.cnkdVatRate / 100);
        merged.cnkdPitAmount = merged.cnkdRevenue * (merged.cnkdPitRate / 100);
        merged.cnkdTotalTax = merged.cnkdVatAmount + merged.cnkdPitAmount;
        updateData.cnkdVatAmount = merged.cnkdVatAmount;
        updateData.cnkdPitAmount = merged.cnkdPitAmount;
        updateData.cnkdTotalTax = merged.cnkdTotalTax;
      }
    }
    const data = await prisma2.taxDeclaration.update({ where: { id }, data: updateData });
    res.json({ success: true, data });
  } catch (err) {
    console.error("PUT /declarations/:id error:", err);
    res.status(500).json({ success: false, error: err?.message || "Internal server error" });
  }
});
router23.delete("/declarations/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await prisma2.taxDeclaration.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /declarations/:id error:", err);
    res.status(500).json({ success: false, error: err?.message || "Internal server error" });
  }
});
router23.get("/declarations/:id/xml", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const decl = await prisma2.taxDeclaration.findUnique({ where: { id } });
    if (!decl) return res.status(404).json({ success: false, error: "Not found" });
    let xml;
    if (decl.formType === "01_CNKD") {
      xml = build01CNKD_Xml(decl);
    } else {
      xml = build01GTGT_Xml(decl);
    }
    const filename = `ToKhai_${decl.formType}_${decl.period.replace("/", "-")}.xml`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(xml);
  } catch (err) {
    console.error("GET /declarations/:id/xml error:", err);
    res.status(500).json({ success: false, error: err?.message || "Internal server error" });
  }
});
var tax_default = router23;

// src/routes/segments.ts
var import_express24 = require("express");
var router24 = (0, import_express24.Router)();
router24.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const data = await prisma2.customerSegment.findMany({ orderBy: { createdAt: "desc" } });
    const parsed = data.map((s) => ({ ...s, conditions: JSON.parse(s.conditions || "{}") }));
    res.json({ success: true, data: parsed });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router24.post("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { name, description, conditions, color } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: "Name required" });
    const cond = conditions || {};
    const customerWhere = {};
    if (cond.minPurchases) customerWhere.totalPurchases = { gte: Number(cond.minPurchases) };
    if (cond.minOrders) customerWhere.totalOrders = { gte: Number(cond.minOrders) };
    if (cond.tier) customerWhere.tier = cond.tier;
    const customerCount = await prisma2.customer.count({ where: customerWhere });
    const data = await prisma2.customerSegment.create({
      data: { name, description, conditions: JSON.stringify(conditions || {}), customerCount, color: color || "#6b7280" }
    });
    res.status(201).json({ success: true, data: { ...data, conditions: JSON.parse(data.conditions) } });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router24.put("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { name, description, conditions, color } = req.body;
    const d = {};
    if (name) d.name = name;
    if (description !== void 0) d.description = description;
    if (conditions) d.conditions = JSON.stringify(conditions);
    if (color) d.color = color;
    const data = await prisma2.customerSegment.update({ where: { id: String(req.params.id) }, data: d });
    res.json({ success: true, data: { ...data, conditions: JSON.parse(data.conditions) } });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router24.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    await prisma2.customerSegment.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var segments_default = router24;

// src/routes/currencies.ts
var import_express25 = require("express");
var router25 = (0, import_express25.Router)();
router25.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const data = await prisma2.currency.findMany({ orderBy: { isBase: "desc" } });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router25.post("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { code, name, symbol, rate, isBase } = req.body;
    if (!code?.trim() || !name?.trim()) return res.status(400).json({ success: false, error: "Code and name required" });
    const existing = await prisma2.currency.findUnique({ where: { code } });
    if (existing) return res.status(400).json({ success: false, error: "Currency code already exists" });
    if (isBase) await prisma2.currency.updateMany({ data: { isBase: false } });
    const data = await prisma2.currency.create({ data: { code: code.toUpperCase(), name, symbol: symbol || code, rate: Number(rate) || 1, isBase: isBase || false } });
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router25.put("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { name, symbol, rate, isBase, status } = req.body;
    if (isBase) await prisma2.currency.updateMany({ data: { isBase: false } });
    const data = await prisma2.currency.update({
      where: { id: String(req.params.id) },
      data: { ...name && { name }, ...symbol && { symbol }, ...rate !== void 0 && { rate: Number(rate) }, ...isBase !== void 0 && { isBase }, ...status && { status } }
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router25.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const c = await prisma2.currency.findUnique({ where: { id: String(req.params.id) } });
    if (c?.isBase) return res.status(400).json({ success: false, error: "Cannot delete base currency" });
    await prisma2.currency.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var currencies_default = router25;

// src/routes/feedback.ts
var import_express26 = require("express");
var router26 = (0, import_express26.Router)();
router26.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { search, type, status } = req.query;
    const where = {};
    if (type && type !== "all") where.type = type;
    if (status && status !== "all") where.status = status;
    if (search) {
      const q = String(search);
      where.OR = [{ message: { contains: q } }, { customerName: { contains: q } }];
    }
    const data = await prisma2.feedback.findMany({ where, orderBy: { createdAt: "desc" } });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router26.post("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { customerName, customerPhone, type, rating, message } = req.body;
    if (!message?.trim()) return res.status(400).json({ success: false, error: "Message required" });
    const data = await prisma2.feedback.create({ data: { customerName, customerPhone, type: type || "general", rating: rating ? Number(rating) : null, message } });
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router26.put("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { status, response } = req.body;
    const data = await prisma2.feedback.update({ where: { id: String(req.params.id) }, data: { ...status && { status }, ...response !== void 0 && { response } } });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router26.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    await prisma2.feedback.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var feedback_default = router26;

// src/routes/schedule.ts
var import_express27 = require("express");
var router27 = (0, import_express27.Router)();
router27.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const { userId, date, shift } = req.query;
    const where = {};
    if (userId) where.userId = userId;
    if (shift && shift !== "all") where.shift = shift;
    if (date) {
      const d = new Date(String(date));
      const start = new Date(d);
      start.setHours(0, 0, 0, 0);
      const end = new Date(d);
      end.setHours(23, 59, 59, 999);
      where.date = { gte: start, lte: end };
    }
    const data = await prisma2.schedule.findMany({ where, orderBy: { date: "desc" } });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router27.post("/", authMiddleware, validate(CreateScheduleSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const { userId, userName, date, shift, notes } = req.body;
    if (!userName?.trim() || !date || !shift) return res.status(400).json({ success: false, error: "Employee, date and shift required" });
    const data = await prisma2.schedule.create({ data: { userId, userName, date: new Date(date), shift, notes } });
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router27.put("/:id", authMiddleware, validate(UpdateScheduleSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const { status, shift, notes } = req.body;
    const schId = String(req.params.id);
    const data = await prisma2.schedule.update({ where: { id: schId }, data: { ...status && { status }, ...shift && { shift }, ...notes !== void 0 && { notes } } });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router27.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    await prisma2.schedule.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var schedule_default = router27;

// src/routes/returns.ts
var import_express28 = require("express");
var router28 = (0, import_express28.Router)();
router28.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { status, search, reason, startDate, endDate } = req.query;
    const where = {};
    if (status && status !== "all") where.status = status;
    if (reason && reason !== "all") where.reason = reason;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }
    if (search) {
      where.OR = [
        { code: { contains: String(search) } },
        { customerName: { contains: String(search) } },
        { originalInvoice: { contains: String(search) } }
      ];
    }
    const returns = await prisma2.returnOrder.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: "desc" }
    });
    res.json({ success: true, data: returns });
  } catch (err) {
    console.error("Get returns error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router28.get("/stats", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const returns = await prisma2.returnOrder.findMany({ ...getBranchFilter(req) });
    const total = returns.length;
    const pending = returns.filter((r) => r.status === "pending").length;
    const approved = returns.filter((r) => r.status === "approved").length;
    const processing = returns.filter((r) => r.status === "processing").length;
    const refunded = returns.filter((r) => r.status === "refunded").length;
    const rejected = returns.filter((r) => r.status === "rejected").length;
    const exchanged = returns.filter((r) => r.status === "exchanged").length;
    const totalRefund = returns.filter((r) => ["refunded", "exchanged"].includes(r.status)).reduce((s, r) => s + r.totalRefund, 0);
    const pendingRefund = returns.filter((r) => ["pending", "approved", "processing"].includes(r.status)).reduce((s, r) => s + r.totalRefund, 0);
    const byReason = {};
    returns.forEach((r) => {
      byReason[r.reason] = (byReason[r.reason] || 0) + 1;
    });
    const byMethod = {};
    returns.filter((r) => r.refundMethod).forEach((r) => {
      byMethod[r.refundMethod] = (byMethod[r.refundMethod] || 0) + 1;
    });
    const now = /* @__PURE__ */ new Date();
    const trend = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      const dayReturns = returns.filter((r) => r.createdAt.toISOString().slice(0, 10) === ds);
      trend.push({ date: ds, count: dayReturns.length, amount: dayReturns.reduce((s, r) => s + r.totalRefund, 0) });
    }
    res.json({
      success: true,
      data: {
        total,
        pending,
        approved,
        processing,
        refunded,
        rejected,
        exchanged,
        totalRefund,
        pendingRefund,
        byReason: Object.entries(byReason).map(([reason, count]) => ({ reason, count })),
        byMethod: Object.entries(byMethod).map(([method, count]) => ({ method, count })),
        trend
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router28.get("/analytics", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { days = "30" } = req.query;
    const since = new Date(Date.now() - Number(days) * 864e5);
    const returns = await prisma2.returnOrder.findMany({
      where: { createdAt: { gte: since } },
      include: { items: true }
    });
    const totalTx = await prisma2.transaction.count({ where: { createdAt: { gte: since } } });
    const returnRate = totalTx > 0 ? returns.length / totalTx * 100 : 0;
    const productMap = {};
    returns.forEach((r) => {
      r.items.forEach((item) => {
        const key = item.productName;
        if (!productMap[key]) productMap[key] = { name: key, count: 0, amount: 0 };
        productMap[key].count += item.quantity;
        productMap[key].amount += item.quantity * item.unitPrice;
      });
    });
    const topProducts = Object.values(productMap).sort((a, b) => b.count - a.count).slice(0, 10);
    const processed = returns.filter((r) => r.processedAt);
    const avgProcessingHours = processed.length > 0 ? processed.reduce((s, r) => s + (r.processedAt.getTime() - r.createdAt.getTime()) / 36e5, 0) / processed.length : 0;
    const allItems = returns.flatMap((r) => r.items);
    const restockedCount = allItems.filter((i) => i.restocked).length;
    const restockRate = allItems.length > 0 ? restockedCount / allItems.length * 100 : 0;
    res.json({
      success: true,
      data: {
        returnRate: Math.round(returnRate * 10) / 10,
        topProducts,
        avgProcessingHours: Math.round(avgProcessingHours * 10) / 10,
        restockRate: Math.round(restockRate * 10) / 10,
        totalReturns: returns.length,
        totalRefundAmount: returns.reduce((s, r) => s + r.totalRefund, 0)
      }
    });
  } catch (err) {
    console.error("Return analytics error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router28.post("/", authMiddleware, validate(CreateReturnSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { code, originalInvoice, transactionId, customerName, customerPhone, reason, items, totalRefund, notes, refundMethod, staffName } = req.body;
    if (!originalInvoice?.trim()) return res.status(400).json({ success: false, error: "Original invoice required" });
    if (!customerName?.trim()) return res.status(400).json({ success: false, error: "Customer name required" });
    const count = await prisma2.returnOrder.count();
    const returnCode = code || `RT-${String(count + 1).padStart(4, "0")}`;
    const returnOrder = await prisma2.returnOrder.create({
      data: {
        code: returnCode,
        originalInvoice: originalInvoice.trim(),
        transactionId: transactionId || null,
        customerName: customerName.trim(),
        customerPhone: customerPhone || null,
        reason: reason || "other",
        totalRefund: Number(totalRefund) || 0,
        refundMethod: refundMethod || null,
        staffName: staffName || null,
        notes: notes || null,
        items: {
          create: (items || []).map((item) => ({
            productId: item.productId || null,
            productName: item.productName,
            sku: item.sku || null,
            quantity: Number(item.quantity) || 1,
            unitPrice: Number(item.unitPrice) || 0,
            returnReason: item.returnReason || null,
            condition: item.condition || null
          }))
        }
      },
      include: { items: true }
    });
    res.status(201).json({ success: true, data: returnOrder });
  } catch (err) {
    console.error("Create return error:", err);
    res.status(500).json({ success: false, error: "Internal server error", detail: err?.message || String(err) });
  }
});
router28.put("/:id", authMiddleware, validate(UpdateReturnSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const retId = String(req.params.id);
    const { status, notes, refundMethod, staffName } = req.body;
    const data = {};
    if (status !== void 0) {
      data.status = status;
      if (["approved", "rejected"].includes(status)) data.processedAt = /* @__PURE__ */ new Date();
      if (["refunded", "exchanged"].includes(status)) {
        data.processedAt = data.processedAt || /* @__PURE__ */ new Date();
        data.refundedAt = /* @__PURE__ */ new Date();
      }
    }
    if (notes !== void 0) data.notes = notes;
    if (refundMethod !== void 0) data.refundMethod = refundMethod;
    if (staffName !== void 0) data.staffName = staffName;
    const returnOrder = await prisma2.returnOrder.update({
      where: { id: retId },
      data,
      include: { items: true }
    });
    res.json({ success: true, data: returnOrder });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router28.post("/:id/process-refund", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const retId = String(req.params.id);
    const { refundMethod, refundAmount, staffName } = req.body;
    const returnOrder = await prisma2.returnOrder.findUnique({
      where: { id: retId },
      include: { items: true }
    });
    if (!returnOrder) return res.status(404).json({ success: false, error: "Kh\xF4ng t\xECm th\u1EA5y phi\u1EBFu tr\u1EA3" });
    if (["refunded", "exchanged", "rejected"].includes(returnOrder.status)) {
      return res.status(400).json({ success: false, error: "Phi\u1EBFu n\xE0y \u0111\xE3 \u0111\u01B0\u1EE3c x\u1EED l\xFD" });
    }
    const amount = Number(refundAmount) || returnOrder.totalRefund;
    const updated = await prisma2.returnOrder.update({
      where: { id: retId },
      data: {
        status: refundMethod === "exchange" ? "exchanged" : "refunded",
        refundMethod: refundMethod || "cash",
        refundAmount: amount,
        staffName: staffName || returnOrder.staffName,
        processedAt: returnOrder.processedAt || /* @__PURE__ */ new Date(),
        refundedAt: /* @__PURE__ */ new Date()
      },
      include: { items: true }
    });
    try {
      const txCount = await prisma2.transaction.count();
      await prisma2.transaction.create({
        data: {
          receiptNumber: `RF-${String(txCount + 1).padStart(4, "0")}`,
          type: "refund",
          customerName: returnOrder.customerName,
          customerPhone: returnOrder.customerPhone || null,
          subtotal: -amount,
          discount: 0,
          tax: 0,
          total: -amount,
          paymentMethod: refundMethod === "bank_transfer" ? "transfer" : refundMethod === "store_credit" ? "credit" : "cash",
          status: "completed",
          items: JSON.stringify(returnOrder.items.map((i) => ({
            productName: i.productName,
            sku: i.sku,
            quantity: -i.quantity,
            unitPrice: i.unitPrice
          }))),
          notes: `Ho\xE0n ti\u1EC1n phi\u1EBFu ${returnOrder.code}`
        }
      });
    } catch (_) {
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error("Process refund error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router28.post("/:id/restock", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const retId = String(req.params.id);
    const { itemIds } = req.body;
    const returnOrder = await prisma2.returnOrder.findUnique({
      where: { id: retId },
      include: { items: true }
    });
    if (!returnOrder) return res.status(404).json({ success: false, error: "Kh\xF4ng t\xECm th\u1EA5y phi\u1EBFu tr\u1EA3" });
    const toRestock = itemIds ? returnOrder.items.filter((i) => itemIds.includes(i.id) && !i.restocked) : returnOrder.items.filter((i) => !i.restocked && i.condition !== "damaged" && i.condition !== "defective");
    let restocked = 0;
    for (const item of toRestock) {
      await prisma2.returnItem.update({
        where: { id: item.id },
        data: { restocked: true }
      });
      if (item.productId) {
        try {
          await prisma2.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } }
          });
        } catch (_) {
        }
      }
      restocked++;
    }
    res.json({ success: true, data: { restocked, total: returnOrder.items.length } });
  } catch (err) {
    console.error("Restock error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router28.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    await prisma2.returnOrder.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var returns_default = router28;

// src/routes/debts.ts
var import_express29 = require("express");
var router29 = (0, import_express29.Router)();
router29.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { customerId, type } = req.query;
    const where = {};
    if (customerId) where.customerId = customerId;
    if (type && type !== "all") where.type = type;
    const entries = await prisma2.debtEntry.findMany({ where, orderBy: { createdAt: "desc" } });
    res.json({ success: true, data: entries });
  } catch (err) {
    console.error("Get debts error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router29.get("/summary", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const customersWithDebt = await prisma2.customer.findMany({
      where: { debt: { gt: 0 } },
      select: { id: true, name: true, phone: true, debt: true }
    });
    const entries = await prisma2.debtEntry.findMany({ orderBy: { createdAt: "asc" } });
    const entryMap = {};
    for (const e of entries) {
      if (!entryMap[e.customerId]) entryMap[e.customerId] = [];
      entryMap[e.customerId].push(e);
    }
    const summaryMap = {};
    for (const c of customersWithDebt) {
      summaryMap[c.id] = {
        customerId: c.id,
        customerName: c.name,
        phone: c.phone || "",
        totalDebt: c.debt,
        entries: entryMap[c.id] || []
      };
    }
    for (const [custId, custEntries] of Object.entries(entryMap)) {
      if (!summaryMap[custId]) {
        const last = custEntries[custEntries.length - 1];
        summaryMap[custId] = {
          customerId: custId,
          customerName: last.customerName,
          phone: last.phone || "",
          totalDebt: last.balance,
          entries: custEntries
        };
      }
    }
    const data = Object.values(summaryMap);
    res.json({ success: true, data });
  } catch (err) {
    console.error("Get debt summary error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router29.post("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { customerId, customerName, phone, type, amount, description } = req.body;
    if (!customerId?.trim()) return res.status(400).json({ success: false, error: "Customer ID required" });
    if (!amount || amount <= 0) return res.status(400).json({ success: false, error: "Valid amount required" });
    const lastEntry = await prisma2.debtEntry.findFirst({
      where: { ...getBranchFilter(req), customerId },
      orderBy: { createdAt: "desc" }
    });
    const currentBalance = lastEntry?.balance ?? 0;
    const newBalance = type === "debt" ? currentBalance + Number(amount) : currentBalance - Number(amount);
    const entry = await prisma2.debtEntry.create({
      data: {
        customerId: customerId.trim(),
        customerName: customerName?.trim() || "Kh\xE1ch h\xE0ng",
        phone: phone || null,
        type: type || "debt",
        amount: Number(amount),
        description: description?.trim() || (type === "debt" ? "Ghi n\u1EE3" : "Tr\u1EA3 n\u1EE3"),
        balance: Math.max(0, newBalance)
      }
    });
    res.status(201).json({ success: true, data: entry });
  } catch (err) {
    console.error("Create debt entry error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router29.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    await prisma2.debtEntry.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var debts_default = router29;

// src/routes/bundles.ts
var import_express30 = require("express");
var router30 = (0, import_express30.Router)();
router30.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { active, category, search } = req.query;
    const where = {};
    if (active === "true") where.active = true;
    if (active === "false") where.active = false;
    if (category && category !== "all") where.category = category;
    if (search) where.name = { contains: String(search) };
    const bundles = await prisma2.bundle.findMany({ where, orderBy: { createdAt: "desc" } });
    const data = bundles.map((b) => ({ ...b, items: JSON.parse(b.items || "[]") }));
    res.json({ success: true, data });
  } catch (err) {
    console.error("Get bundles error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router30.post("/", authMiddleware, validate(CreateBundleSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { name, category, items, originalTotal, bundlePrice, discount, active, validUntil, maxUsage } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: "Bundle name required" });
    const bundle = await prisma2.bundle.create({
      data: {
        name: name.trim(),
        category: category || null,
        items: JSON.stringify(items || []),
        originalTotal: Number(originalTotal) || 0,
        bundlePrice: Number(bundlePrice) || 0,
        discount: Number(discount) || 0,
        active: active !== false,
        validUntil: validUntil ? new Date(validUntil) : null,
        maxUsage: maxUsage ? Number(maxUsage) : null
      }
    });
    res.status(201).json({ success: true, data: { ...bundle, items: JSON.parse(bundle.items) } });
  } catch (err) {
    console.error("Create bundle error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router30.put("/:id", authMiddleware, validate(UpdateBundleSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { name, category, items, originalTotal, bundlePrice, discount, active, soldCount, validUntil, maxUsage } = req.body;
    const bundleId = String(req.params.id);
    const data = {};
    if (name !== void 0) data.name = name;
    if (category !== void 0) data.category = category;
    if (items !== void 0) data.items = JSON.stringify(items);
    if (originalTotal !== void 0) data.originalTotal = Number(originalTotal);
    if (bundlePrice !== void 0) data.bundlePrice = Number(bundlePrice);
    if (discount !== void 0) data.discount = Number(discount);
    if (active !== void 0) data.active = active;
    if (soldCount !== void 0) data.soldCount = Number(soldCount);
    if (validUntil !== void 0) data.validUntil = validUntil ? new Date(validUntil) : null;
    if (maxUsage !== void 0) data.maxUsage = maxUsage ? Number(maxUsage) : null;
    const bundle = await prisma2.bundle.update({ where: { id: bundleId }, data });
    res.json({ success: true, data: { ...bundle, items: JSON.parse(bundle.items) } });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router30.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    await prisma2.bundle.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var bundles_default = router30;

// src/routes/apiKeys.ts
var import_express31 = require("express");
var import_crypto = __toESM(require("crypto"));
var import_bcryptjs4 = __toESM(require("bcryptjs"));
var router31 = (0, import_express31.Router)();
router31.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    if (req.user.role !== "admin" && req.user.role !== "manager") {
      res.status(403).json({ success: false, error: "Ch\u1EC9 admin/manager m\u1EDBi c\xF3 quy\u1EC1n" });
      return;
    }
    const key = await prisma2.apiKey.findFirst({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        keyId: true,
        lastFour: true,
        scopes: true,
        isActive: true,
        lastUsedAt: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } }
      }
    });
    res.json({ success: true, data: key });
  } catch (err) {
    console.error("Get API key error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router31.post("/regenerate", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    if (req.user.role !== "admin" && req.user.role !== "manager") {
      res.status(403).json({ success: false, error: "Ch\u1EC9 admin/manager m\u1EDBi c\xF3 quy\u1EC1n" });
      return;
    }
    await prisma2.apiKey.deleteMany({});
    const keyId = "ak_" + import_crypto.default.randomBytes(12).toString("hex");
    const secret = import_crypto.default.randomBytes(32).toString("hex");
    const lastFour = secret.slice(-4);
    const secretHash = await import_bcryptjs4.default.hash(secret, 10);
    const apiKey = await prisma2.apiKey.create({
      data: {
        name: "API Secret",
        keyId,
        secretHash,
        lastFour,
        scopes: "admin",
        userId: req.user.userId
      },
      select: {
        id: true,
        name: true,
        keyId: true,
        lastFour: true,
        scopes: true,
        isActive: true,
        createdAt: true
      }
    });
    res.json({
      success: true,
      data: {
        ...apiKey,
        secret
        // ⚠️ Only returned once
      }
    });
  } catch (err) {
    console.error("Regenerate API key error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router31.post("/test", async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const apiKeyHeader = req.headers["x-api-key"];
    if (!apiKeyHeader) {
      res.status(401).json({ success: false, error: "Thi\u1EBFu header X-API-Key" });
      return;
    }
    const keys = await prisma2.apiKey.findMany({
      where: { isActive: true },
      include: { user: { select: { id: true, name: true, email: true, role: true } } }
    });
    let matchedKey = null;
    for (const key of keys) {
      if (key.expiresAt && key.expiresAt < /* @__PURE__ */ new Date()) continue;
      const valid = await import_bcryptjs4.default.compare(apiKeyHeader, key.secretHash);
      if (valid) {
        matchedKey = key;
        break;
      }
    }
    if (!matchedKey) {
      res.status(401).json({ success: false, error: "API key kh\xF4ng h\u1EE3p l\u1EC7 ho\u1EB7c \u0111\xE3 h\u1EBFt h\u1EA1n" });
      return;
    }
    await prisma2.apiKey.update({
      where: { id: matchedKey.id },
      data: { lastUsedAt: /* @__PURE__ */ new Date() }
    });
    res.json({
      success: true,
      data: {
        keyId: matchedKey.keyId,
        scopes: matchedKey.scopes,
        user: matchedKey.user.name,
        message: "\u2705 API key ho\u1EA1t \u0111\u1ED9ng t\u1ED1t!"
      }
    });
  } catch (err) {
    console.error("Test API key error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var apiKeys_default = router31;

// src/routes/financialReports.ts
var import_express32 = require("express");
init_bigquery();
var router32 = (0, import_express32.Router)();
router32.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const period = req.query.period || "thisMonth";
    const now = /* @__PURE__ */ new Date();
    let startDate;
    let endDate = now;
    switch (period) {
      case "lastMonth": {
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
        break;
      }
      case "3months":
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1e3);
        break;
      case "6months":
        startDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1e3);
        break;
      case "year":
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1e3);
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }
    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();
    if (isBigQueryEnabled()) {
      try {
        const data2 = await buildReportFromBigQuery(startISO, endISO, period);
        return res.json({ success: true, data: data2, source: "bigquery" });
      } catch (bqErr) {
        console.warn("[Report] BigQuery failed, falling back to Prisma:", bqErr.message);
      }
    }
    const data = await buildReportFromPrisma(prisma2, startDate, endDate, period);
    res.json({ success: true, data, source: "prisma" });
  } catch (err) {
    console.error("Financial report error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
async function buildReportFromBigQuery(startISO, endISO, period) {
  const [pnlResult, expenseResult, dailyResult, paymentResult, topProductsResult, debtResult, prevResult] = await Promise.all([
    queryBQ(`SELECT COUNT(*) as totalOrders, COALESCE(SUM(total),0) as totalRevenue, COALESCE(SUM(discount),0) as totalDiscount, COALESCE(SUM(tax),0) as totalTax FROM transactions WHERE createdAt >= @startDate AND createdAt <= @endDate AND status != 'voided'`, { startDate: startISO, endDate: endISO }),
    queryBQ(`SELECT category, COALESCE(SUM(amount),0) as total FROM expenses WHERE date >= @startDate AND date <= @endDate GROUP BY category`, { startDate: startISO, endDate: endISO }),
    queryBQ(`SELECT FORMAT_DATE('%Y-%m-%d', DATE(t.createdAt)) as date, COALESCE(SUM(t.total),0) as revenue, COUNT(*) as orders, COALESCE(SUM(ti.costPrice*ti.quantity),0) as cogs FROM transactions t LEFT JOIN transaction_items ti ON t.id=ti.transactionId WHERE t.createdAt >= @startDate AND t.createdAt <= @endDate AND t.status != 'voided' GROUP BY date ORDER BY date`, { startDate: startISO, endDate: endISO }),
    queryBQ(`SELECT paymentMethod, COALESCE(SUM(total),0) as amount FROM transactions WHERE createdAt >= @startDate AND createdAt <= @endDate AND status != 'voided' GROUP BY paymentMethod`, { startDate: startISO, endDate: endISO }),
    queryBQ(`SELECT productId, productName as name, COALESCE(SUM(lineTotal),0) as revenue, COALESCE(SUM(quantity),0) as quantity, COALESCE(SUM(costPrice*quantity),0) as cost FROM transaction_items ti JOIN transactions t ON t.id=ti.transactionId WHERE t.createdAt >= @startDate AND t.createdAt <= @endDate AND t.status != 'voided' GROUP BY productId, productName ORDER BY revenue DESC LIMIT 10`, { startDate: startISO, endDate: endISO }),
    queryBQ(`SELECT type, COALESCE(SUM(amount),0) as total FROM debt_entries WHERE createdAt >= @startDate AND createdAt <= @endDate GROUP BY type`, { startDate: startISO, endDate: endISO }),
    (() => {
      const start = new Date(startISO), end = new Date(endISO);
      const dur = end.getTime() - start.getTime();
      const ps = new Date(start.getTime() - dur).toISOString();
      const pe = new Date(start.getTime() - 1).toISOString();
      return queryBQ(`SELECT COALESCE(SUM(total),0) as revenue FROM transactions WHERE createdAt >= @startDate AND createdAt <= @endDate AND status != 'voided'`, { startDate: ps, endDate: pe });
    })()
  ]);
  const pnl = pnlResult[0] || { totalOrders: 0, totalRevenue: 0, totalDiscount: 0, totalTax: 0 };
  const totalCOGS = dailyResult.reduce((s, d) => s + (d.cogs || 0), 0);
  const grossProfit = pnl.totalRevenue - totalCOGS;
  const grossMargin = pnl.totalRevenue > 0 ? grossProfit / pnl.totalRevenue * 100 : 0;
  const expenseByCategory = {};
  let totalExpenses = 0;
  expenseResult.forEach((e) => {
    expenseByCategory[e.category] = e.total;
    totalExpenses += e.total;
  });
  const operatingProfit = grossProfit - totalExpenses;
  const netProfit = operatingProfit;
  const netMargin = pnl.totalRevenue > 0 ? netProfit / pnl.totalRevenue * 100 : 0;
  const dailyExpenses = await queryBQ(`SELECT FORMAT_DATE('%Y-%m-%d', DATE(date)) as date, COALESCE(SUM(amount),0) as expense FROM expenses WHERE date >= @startDate AND date <= @endDate GROUP BY date`, { startDate: startISO, endDate: endISO }).catch(() => []);
  const expByDay = {};
  dailyExpenses.forEach((e) => {
    expByDay[e.date] = e.expense;
  });
  const dailyData = dailyResult.map((d) => ({ date: d.date, revenue: d.revenue, orders: d.orders, cogs: d.cogs, expense: expByDay[d.date] || 0 }));
  const paymentBreakdown = {};
  paymentResult.forEach((p) => {
    paymentBreakdown[p.paymentMethod || "cash"] = p.amount;
  });
  const topProducts = topProductsResult.map((p) => ({ name: p.name, revenue: p.revenue, quantity: p.quantity, cost: p.cost, profit: p.revenue - p.cost, margin: p.revenue > 0 ? (p.revenue - p.cost) / p.revenue * 100 : 0 }));
  const debtAmt = debtResult.find((d) => d.type === "debt")?.total || 0;
  const debtPay = debtResult.find((d) => d.type === "payment")?.total || 0;
  const netReceivable = Math.max(0, debtAmt - debtPay);
  const prevRevenue = prevResult[0]?.revenue || 0;
  const revenueGrowth = prevRevenue > 0 ? (pnl.totalRevenue - prevRevenue) / prevRevenue * 100 : pnl.totalRevenue > 0 ? 100 : 0;
  const inv = await queryBQ(`SELECT COALESCE(SUM(costPrice*stock),0) as inventoryCost, COALESCE(SUM(sellingPrice*stock),0) as inventoryRetail, COUNT(*) as totalSKUs, COUNTIF(stock<=10 AND stock>=0) as lowStock FROM products_snapshot WHERE snapshotDate=(SELECT MAX(snapshotDate) FROM products_snapshot)`).catch(() => [{ inventoryCost: 0, inventoryRetail: 0, totalSKUs: 0, lowStock: 0 }]);
  const invData = inv[0] || { inventoryCost: 0, inventoryRetail: 0, totalSKUs: 0, lowStock: 0 };
  const cashBalance = Math.max(0, pnl.totalRevenue + debtPay - totalExpenses);
  const totalAssets = cashBalance + invData.inventoryCost + netReceivable;
  const accountsPayable = 0;
  const totalLiabilities = accountsPayable;
  const totalEquity = totalAssets - totalLiabilities;
  const contributedCapital = totalEquity - netProfit;
  return {
    period: { start: startISO, end: endISO, label: period },
    pnl: { revenue: pnl.totalRevenue, discount: pnl.totalDiscount, tax: pnl.totalTax, cogs: totalCOGS, grossProfit, grossMargin, expenses: totalExpenses, expenseByCategory, operatingProfit, netProfit, netMargin },
    balance: {
      assets: { cash: cashBalance, inventoryCost: invData.inventoryCost, inventoryRetail: invData.inventoryRetail, accountsReceivable: netReceivable, total: totalAssets },
      liabilities: { accountsPayable, total: totalLiabilities },
      equity: { retainedEarnings: netProfit, inventoryCapital: contributedCapital, total: totalEquity }
    },
    cashflow: {
      inflow: pnl.totalRevenue + debtPay,
      outflow: totalExpenses + totalCOGS,
      net: pnl.totalRevenue + debtPay - (totalExpenses + totalCOGS),
      byActivity: { operating: { inflow: pnl.totalRevenue, outflow: totalCOGS }, expenses: { inflow: 0, outflow: totalExpenses }, financing: { inflow: debtPay, outflow: 0 } }
    },
    kpis: { totalOrders: pnl.totalOrders, avgOrderValue: pnl.totalOrders > 0 ? pnl.totalRevenue / pnl.totalOrders : 0, revenueGrowth, totalSKUs: invData.totalSKUs, lowStockCount: invData.lowStock },
    dailyData,
    paymentBreakdown,
    topProducts
  };
}
async function buildReportFromPrisma(prisma2, startDate, endDate, period) {
  const duration = endDate.getTime() - startDate.getTime();
  const prevStart = new Date(startDate.getTime() - duration);
  const prevEnd = new Date(startDate.getTime() - 1);
  const [transactions, expenses, allProducts, debtEntries, previousPeriodTx, importReceipts] = await Promise.all([
    prisma2.transaction.findMany({
      where: { createdAt: { gte: startDate, lte: endDate }, status: { not: "voided" } },
      include: { items: { include: { product: { select: { costPrice: true } } } }, payments: true }
    }),
    prisma2.expense.findMany({ where: { date: { gte: startDate, lte: endDate } } }),
    prisma2.product.findMany({ select: { id: true, name: true, costPrice: true, sellingPrice: true, stock: true } }),
    prisma2.debtEntry.findMany({ where: { createdAt: { gte: startDate, lte: endDate } } }),
    prisma2.transaction.findMany({
      where: { createdAt: { gte: prevStart, lte: prevEnd }, status: { not: "voided" } },
      select: { total: true }
    }),
    // Accounts payable: unpaid import receipts (all time up to endDate)
    prisma2.importReceipt.findMany({
      where: { createdAt: { lte: endDate } },
      select: { totalAmount: true, paidAmount: true }
    }).catch(() => [])
  ]);
  const totalRevenue = transactions.reduce((s, t) => s + t.total, 0);
  const totalDiscount = transactions.reduce((s, t) => s + t.discount, 0);
  const totalTax = transactions.reduce((s, t) => s + t.tax, 0);
  const totalCOGS = transactions.reduce((s, t) => s + t.items.reduce((is, item) => is + (item.product?.costPrice ?? 0) * item.quantity, 0), 0);
  const grossProfit = totalRevenue - totalCOGS;
  const grossMargin = totalRevenue > 0 ? grossProfit / totalRevenue * 100 : 0;
  const expenseByCategory = {};
  let totalExpenses = 0;
  expenses.forEach((e) => {
    const cat = e.category || "Kh\xE1c";
    expenseByCategory[cat] = (expenseByCategory[cat] || 0) + e.amount;
    totalExpenses += e.amount;
  });
  const operatingProfit = grossProfit - totalExpenses;
  const netProfit = operatingProfit;
  const netMargin = totalRevenue > 0 ? netProfit / totalRevenue * 100 : 0;
  const revenueByDay = {};
  transactions.forEach((tx) => {
    const day = tx.createdAt.toISOString().slice(0, 10);
    if (!revenueByDay[day]) revenueByDay[day] = { date: day, revenue: 0, expense: 0, orders: 0, cogs: 0 };
    revenueByDay[day].revenue += tx.total;
    revenueByDay[day].orders += 1;
    revenueByDay[day].cogs += tx.items.reduce((s, item) => s + (item.product?.costPrice ?? 0) * item.quantity, 0);
  });
  expenses.forEach((ex) => {
    const day = new Date(ex.date).toISOString().slice(0, 10);
    if (!revenueByDay[day]) revenueByDay[day] = { date: day, revenue: 0, expense: 0, orders: 0, cogs: 0 };
    revenueByDay[day].expense += ex.amount;
  });
  const dailyData = Object.values(revenueByDay).sort((a, b) => a.date.localeCompare(b.date));
  const paymentBreakdown = {};
  transactions.forEach((tx) => {
    tx.payments.forEach((p) => {
      paymentBreakdown[p.type] = (paymentBreakdown[p.type] || 0) + p.amount;
    });
  });
  const productRevenue = {};
  transactions.forEach((tx) => {
    tx.items.forEach((item) => {
      if (!productRevenue[item.productId]) productRevenue[item.productId] = { name: item.productName, revenue: 0, quantity: 0, cost: 0 };
      productRevenue[item.productId].revenue += item.lineTotal;
      productRevenue[item.productId].quantity += item.quantity;
      productRevenue[item.productId].cost += (item.product?.costPrice ?? 0) * item.quantity;
    });
  });
  const topProducts = Object.values(productRevenue).sort((a, b) => b.revenue - a.revenue).slice(0, 10).map((p) => ({ ...p, profit: p.revenue - p.cost, margin: p.revenue > 0 ? (p.revenue - p.cost) / p.revenue * 100 : 0 }));
  const inventoryCostValue = allProducts.reduce((s, p) => s + p.costPrice * p.stock, 0);
  const inventoryRetailValue = allProducts.reduce((s, p) => s + p.sellingPrice * p.stock, 0);
  const totalAR = debtEntries.filter((d) => d.type === "debt").reduce((s, d) => s + d.amount, 0);
  const totalARPaid = debtEntries.filter((d) => d.type === "payment").reduce((s, d) => s + d.amount, 0);
  const netReceivable = Math.max(0, totalAR - totalARPaid);
  const cashBalance = Math.max(0, totalRevenue + totalARPaid - totalExpenses);
  const totalAssets = cashBalance + inventoryCostValue + netReceivable;
  const accountsPayable = importReceipts.reduce((s, r) => {
    if (r.status === "completed") return s;
    return s + (r.totalCost || 0);
  }, 0);
  const totalLiabilities = accountsPayable;
  const totalEquity = totalAssets - totalLiabilities;
  const retainedEarnings = netProfit;
  const contributedCapital = totalEquity - retainedEarnings;
  const prevRevenue = previousPeriodTx.reduce((s, t) => s + t.total, 0);
  const revenueGrowth = prevRevenue > 0 ? (totalRevenue - prevRevenue) / prevRevenue * 100 : totalRevenue > 0 ? 100 : 0;
  return {
    period: { start: startDate.toISOString(), end: endDate.toISOString(), label: period },
    pnl: { revenue: totalRevenue, discount: totalDiscount, tax: totalTax, cogs: totalCOGS, grossProfit, grossMargin, expenses: totalExpenses, expenseByCategory, operatingProfit, netProfit, netMargin },
    balance: {
      assets: { cash: cashBalance, inventoryCost: inventoryCostValue, inventoryRetail: inventoryRetailValue, accountsReceivable: netReceivable, total: totalAssets },
      liabilities: { accountsPayable, total: totalLiabilities },
      // equity.total = assets.total - liabilities.total → LUÔN CÂN BẰNG
      equity: { retainedEarnings, inventoryCapital: contributedCapital, total: totalEquity }
    },
    cashflow: {
      inflow: totalRevenue + totalARPaid,
      outflow: totalExpenses + totalCOGS,
      net: totalRevenue + totalARPaid - (totalExpenses + totalCOGS),
      byActivity: { operating: { inflow: totalRevenue, outflow: totalCOGS }, expenses: { inflow: 0, outflow: totalExpenses }, financing: { inflow: totalARPaid, outflow: 0 } }
    },
    kpis: { totalOrders: transactions.length, avgOrderValue: transactions.length > 0 ? totalRevenue / transactions.length : 0, revenueGrowth, totalSKUs: allProducts.length, lowStockCount: allProducts.filter((p) => p.stock <= 10 && p.stock >= 0).length },
    dailyData,
    paymentBreakdown,
    topProducts
  };
}
var financialReports_default = router32;

// src/routes/salesTracking.ts
var import_express33 = require("express");
var router33 = (0, import_express33.Router)();
var userSelect = { id: true, name: true, code: true, avatar: true, role: true };
router33.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { userId, from, to, type } = req.query;
    const where = {};
    if (userId) where.userId = String(userId);
    if (type) where.type = String(type);
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = /* @__PURE__ */ new Date(String(from) + "T00:00:00");
      if (to) where.createdAt.lte = /* @__PURE__ */ new Date(String(to) + "T23:59:59");
    }
    const records = await prisma2.salesCheckin.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: userSelect },
        customer: { select: { id: true, name: true, code: true, phone: true, address: true } }
      }
    });
    res.json({ success: true, data: records });
  } catch (err) {
    console.error("Sales tracking list error:", err);
    res.status(500).json({ success: false, error: "Internal server error", detail: err?.message });
  }
});
router33.get("/active", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const today = /* @__PURE__ */ new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const todayRecords = await prisma2.salesCheckin.findMany({
      where: { createdAt: { gte: today, lt: tomorrow } },
      orderBy: { createdAt: "desc" },
      include: { user: { select: userSelect } }
    });
    const userLastRecord = /* @__PURE__ */ new Map();
    for (const r of todayRecords) {
      if (!userLastRecord.has(r.userId)) {
        userLastRecord.set(r.userId, r);
      }
    }
    const activeStaff = [];
    for (const [, record] of userLastRecord) {
      if (record.type === "checkin") {
        activeStaff.push({
          id: record.userId,
          name: record.user?.name || "N/A",
          code: record.user?.code || "",
          avatar: record.user?.avatar || null,
          role: record.user?.role || "",
          lastCheckin: record
        });
      }
    }
    res.json({ success: true, data: activeStaff });
  } catch (err) {
    console.error("Active staff error:", err);
    res.status(500).json({ success: false, error: "Internal server error", detail: err?.message });
  }
});
router33.get("/stats", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const dateStr = req.query.date ? String(req.query.date) : (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const dayStart = /* @__PURE__ */ new Date(dateStr + "T00:00:00");
    const dayEnd = /* @__PURE__ */ new Date(dateStr + "T23:59:59");
    const todayRecords = await prisma2.salesCheckin.findMany({
      where: { createdAt: { gte: dayStart, lte: dayEnd } },
      orderBy: { createdAt: "asc" }
    });
    const checkins = todayRecords.filter((r) => r.type === "checkin");
    const checkouts = todayRecords.filter((r) => r.type === "checkout");
    let totalMinutes = 0;
    const userRecords = /* @__PURE__ */ new Map();
    todayRecords.forEach((r) => {
      if (!userRecords.has(r.userId)) userRecords.set(r.userId, []);
      userRecords.get(r.userId).push(r);
    });
    for (const [, recs] of userRecords) {
      for (let i = 0; i < recs.length; i++) {
        if (recs[i].type === "checkin") {
          const co = recs.find((r, j) => j > i && r.type === "checkout");
          if (co) totalMinutes += (co.createdAt.getTime() - recs[i].createdAt.getTime()) / 6e4;
        }
      }
    }
    const checkedInUserIds = new Set(checkins.map((r) => r.userId));
    const allActiveEmployees = await prisma2.user.findMany({
      where: { employeeStatus: "active", role: { in: ["sales", "cashier"] } },
      select: { id: true, name: true, code: true }
    });
    const uncheckedIn = allActiveEmployees.filter((e) => !checkedInUserIds.has(e.id));
    let currentlyActive = 0;
    for (const [, recs] of userRecords) {
      const last = recs[recs.length - 1];
      if (last && last.type === "checkin") currentlyActive++;
    }
    const uniqueCustomers = new Set(checkins.filter((r) => r.customerId).map((r) => r.customerId)).size;
    res.json({
      success: true,
      data: {
        totalCheckins: checkins.length,
        totalCheckouts: checkouts.length,
        currentlyActive,
        totalHours: Math.round(totalMinutes / 60 * 10) / 10,
        totalEmployees: allActiveEmployees.length,
        checkedInCount: checkedInUserIds.size,
        uncheckedIn,
        uniqueCustomers
      }
    });
  } catch (err) {
    console.error("Stats error:", err);
    res.status(500).json({ success: false, error: "Internal server error", detail: err?.message });
  }
});
router33.get("/leaderboard", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const days = Number(req.query.days) || 7;
    const startDate = /* @__PURE__ */ new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);
    const records = await prisma2.salesCheckin.findMany({
      where: { createdAt: { gte: startDate } },
      orderBy: { createdAt: "asc" },
      include: { user: { select: userSelect } }
    });
    const userMap = /* @__PURE__ */ new Map();
    for (const r of records) {
      if (!userMap.has(r.userId)) {
        userMap.set(r.userId, {
          id: r.userId,
          name: r.user?.name || "N/A",
          code: r.user?.code || "",
          avatar: r.user?.avatar || null,
          checkins: 0,
          totalMinutes: 0,
          customerSet: /* @__PURE__ */ new Set(),
          records: []
        });
      }
      const u = userMap.get(r.userId);
      u.records.push(r);
      if (r.type === "checkin") {
        u.checkins++;
        if (r.customerId) u.customerSet.add(r.customerId);
      }
    }
    for (const [, u] of userMap) {
      for (let i = 0; i < u.records.length; i++) {
        if (u.records[i].type === "checkin") {
          const co = u.records.find((r, j) => j > i && r.type === "checkout");
          if (co) u.totalMinutes += (co.createdAt.getTime() - u.records[i].createdAt.getTime()) / 6e4;
        }
      }
    }
    const leaderboard = Array.from(userMap.values()).map((u) => ({
      id: u.id,
      name: u.name,
      code: u.code,
      avatar: u.avatar,
      checkins: u.checkins,
      hours: Math.round(u.totalMinutes / 60 * 10) / 10,
      customers: u.customerSet.size
    })).sort((a, b) => b.checkins - a.checkins).slice(0, 10);
    res.json({ success: true, data: leaderboard });
  } catch (err) {
    console.error("Leaderboard error:", err);
    res.status(500).json({ success: false, error: "Internal server error", detail: err?.message });
  }
});
router33.get("/:userId/history", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const records = await prisma2.salesCheckin.findMany({
      where: { userId: String(req.params.userId) },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        customer: { select: { id: true, name: true, code: true } }
      }
    });
    const today = /* @__PURE__ */ new Date();
    today.setHours(0, 0, 0, 0);
    const todayRecs = records.filter((r) => r.createdAt >= today).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    let todayMinutes = 0;
    for (let i = 0; i < todayRecs.length; i++) {
      if (todayRecs[i].type === "checkin") {
        const co = todayRecs.find((r, j) => j > i && r.type === "checkout");
        if (co) todayMinutes += (co.createdAt.getTime() - todayRecs[i].createdAt.getTime()) / 6e4;
      }
    }
    res.json({ success: true, data: records, todayHours: Math.round(todayMinutes / 60 * 10) / 10 });
  } catch (err) {
    console.error("User history error:", err);
    res.status(500).json({ success: false, error: "Internal server error", detail: err?.message });
  }
});
router33.post("/checkin", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const currentUser = req.user;
    const { latitude, longitude, address, note, customerId, customerName } = req.body;
    if (!latitude || !longitude) {
      return res.status(400).json({ success: false, error: "C\u1EA7n v\u1ECB tr\xED GPS" });
    }
    const record = await prisma2.salesCheckin.create({
      data: {
        userId: currentUser.userId,
        type: "checkin",
        latitude: Number(latitude),
        longitude: Number(longitude),
        address: address || null,
        note: note || null,
        customerId: customerId || null,
        customerName: customerName || null
      },
      include: {
        user: { select: userSelect },
        customer: { select: { id: true, name: true, code: true } }
      }
    });
    res.status(201).json({ success: true, data: record });
  } catch (err) {
    console.error("Checkin error:", err);
    res.status(500).json({ success: false, error: "Internal server error", detail: err?.message });
  }
});
router33.post("/checkout", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const currentUser = req.user;
    const { latitude, longitude, address, note } = req.body;
    if (!latitude || !longitude) {
      return res.status(400).json({ success: false, error: "C\u1EA7n v\u1ECB tr\xED GPS" });
    }
    const today = /* @__PURE__ */ new Date();
    today.setHours(0, 0, 0, 0);
    const lastCheckin = await prisma2.salesCheckin.findFirst({
      where: {
        userId: currentUser.userId,
        type: "checkin",
        createdAt: { gte: today }
      },
      orderBy: { createdAt: "desc" }
    });
    const record = await prisma2.salesCheckin.create({
      data: {
        userId: currentUser.userId,
        type: "checkout",
        latitude: Number(latitude),
        longitude: Number(longitude),
        address: address || null,
        note: note || null
      },
      include: {
        user: { select: userSelect }
      }
    });
    let sessionDuration = 0;
    if (lastCheckin) {
      sessionDuration = Math.round((record.createdAt.getTime() - lastCheckin.createdAt.getTime()) / 6e4);
    }
    res.status(201).json({ success: true, data: record, sessionDuration });
  } catch (err) {
    console.error("Checkout error:", err);
    res.status(500).json({ success: false, error: "Internal server error", detail: err?.message });
  }
});
var salesTracking_default = router33;

// src/routes/salesOrders.ts
var import_express34 = require("express");
var router34 = (0, import_express34.Router)();
router34.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const { status, salesUserId } = req.query;
    const where = {};
    if (status && status !== "all") where.status = String(status);
    if (salesUserId) where.salesUserId = String(salesUserId);
    const orders = await prisma2.salesOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        salesUser: { select: { id: true, name: true, code: true, avatar: true } },
        customer: { select: { id: true, name: true, code: true, phone: true } },
        items: true
      }
    });
    res.json({ success: true, data: orders });
  } catch (err) {
    console.error("Get sales orders error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router34.get("/pending/count", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const count = await prisma2.salesOrder.count({ where: { ...getBranchFilter(req), status: "pending" } });
    res.json({ success: true, data: { count } });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router34.post("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const currentUser = req.user;
    const { customerId, customerName, note, items, discount } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: "C\u1EA7n \xEDt nh\u1EA5t 1 s\u1EA3n ph\u1EA9m" });
    }
    const count = await prisma2.salesOrder.count();
    const orderNumber = `SO-${String(count + 1).padStart(4, "0")}`;
    const orderItems = items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      sku: item.sku || "",
      quantity: Number(item.quantity) || 1,
      unitPrice: Number(item.unitPrice) || 0,
      lineTotal: (Number(item.quantity) || 1) * (Number(item.unitPrice) || 0)
    }));
    const subtotal = orderItems.reduce((s, i) => s + i.lineTotal, 0);
    const discountAmount = Number(discount) || 0;
    const total = subtotal - discountAmount;
    const order = await prisma2.salesOrder.create({
      data: {
        orderNumber,
        salesUserId: currentUser.id,
        customerId: customerId || null,
        customerName: customerName || null,
        note: note?.trim() || null,
        subtotal,
        discount: discountAmount,
        total,
        items: {
          create: orderItems
        }
      },
      include: {
        salesUser: { select: { id: true, name: true, code: true } },
        items: true
      }
    });
    res.status(201).json({ success: true, data: order });
  } catch (err) {
    console.error("Create sales order error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router34.put("/:id/status", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const { status } = req.body;
    const validStatuses = ["pending", "processing", "completed", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: "Invalid status" });
    }
    const order = await prisma2.salesOrder.update({
      where: { id: String(req.params.id) },
      data: { status },
      include: {
        salesUser: { select: { id: true, name: true, code: true } },
        items: true
      }
    });
    res.json({ success: true, data: order });
  } catch (err) {
    console.error("Update sales order status error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router34.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const order = await prisma2.salesOrder.findUnique({ where: { id: String(req.params.id) } });
    if (!order) return res.status(404).json({ success: false, error: "Not found" });
    if (order.status !== "pending" && order.status !== "cancelled") {
      return res.status(400).json({ success: false, error: "Ch\u1EC9 x\xF3a \u0111\u01B0\u1EE3c \u0111\u01A1n pending/cancelled" });
    }
    await prisma2.salesOrder.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var salesOrders_default = router34;

// src/routes/importReceipts.ts
var import_express35 = require("express");

// src/lib/costPrice.ts
function calculateCostPrice(method, input) {
  const { currentStock, currentCostPrice, transactionQty, transactionUnitPrice } = input;
  switch (method) {
    case "fixed":
      return currentCostPrice;
    case "average": {
      if (transactionQty <= 0) return currentCostPrice;
      const newStock = currentStock + transactionQty;
      if (newStock <= 0) return currentCostPrice;
      const weightedCost = (currentStock * currentCostPrice + transactionQty * transactionUnitPrice) / newStock;
      return Math.round(weightedCost);
    }
    case "lastImport":
      if (transactionQty <= 0) return currentCostPrice;
      return transactionUnitPrice;
    default:
      return currentCostPrice;
  }
}
async function getCostPriceMethod(prisma2) {
  try {
    const store = await prisma2.store.findFirst();
    return store?.costPriceMethod || "fixed";
  } catch {
    return "fixed";
  }
}

// src/routes/importReceipts.ts
var router35 = (0, import_express35.Router)();
router35.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const {
      search,
      status,
      page = "1",
      pageSize = "20"
    } = req.query;
    const where = {};
    if (search) {
      const s = String(search);
      where.OR = [
        { code: { contains: s } },
        { supplierName: { contains: s } },
        { note: { contains: s } }
      ];
    }
    if (status) where.status = String(status);
    const pageNum = Math.max(1, parseInt(String(page)));
    const size = Math.max(1, Math.min(100, parseInt(String(pageSize))));
    const skip2 = (pageNum - 1) * size;
    const [total, receipts] = await Promise.all([
      prisma2.importReceipt.count({ where }),
      prisma2.importReceipt.findMany({
        where,
        include: { items: true },
        orderBy: { createdAt: "desc" },
        skip: skip2,
        take: size
      })
    ]);
    res.json({
      success: true,
      data: {
        items: receipts.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          transactionDate: r.transactionDate?.toISOString() || r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString()
        })),
        total,
        page: pageNum,
        pageSize: size,
        totalPages: Math.ceil(total / size)
      }
    });
  } catch (err) {
    console.error("Get import receipts error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router35.get("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const receipt = await prisma2.importReceipt.findUnique({
      where: { id: String(req.params.id) },
      include: { items: true }
    });
    if (!receipt) {
      res.status(404).json({ success: false, error: "Not found" });
      return;
    }
    res.json({
      success: true,
      data: { ...receipt, createdAt: receipt.createdAt.toISOString(), updatedAt: receipt.updatedAt.toISOString() }
    });
  } catch (err) {
    console.error("Get import receipt error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router35.post("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const { items, ...receiptData } = req.body;
    const user = req.user;
    const dbUser = await prisma2.user.findUnique({ where: { id: user.userId || user.id } });
    const userName = dbUser?.name || user.email || "Unknown";
    const today = /* @__PURE__ */ new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
    const count = await prisma2.importReceipt.count({
      where: {
        ...getBranchFilter(req),
        createdAt: {
          gte: new Date(today.getFullYear(), today.getMonth(), today.getDate())
        }
      }
    });
    const code = `NH-${dateStr}-${String(count + 1).padStart(3, "0")}`;
    const totalCost = items.reduce((sum, item) => sum + item.quantity * item.costPrice, 0);
    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
    const receipt = await prisma2.importReceipt.create({
      data: {
        code,
        supplierId: receiptData.supplierId || null,
        supplierName: receiptData.supplierName || null,
        totalCost,
        totalItems,
        status: receiptData.status || "draft",
        note: receiptData.note || null,
        userId: user.userId || user.id,
        userName,
        transactionDate: receiptData.transactionDate ? new Date(receiptData.transactionDate) : null,
        items: {
          create: items.map((item) => ({
            productId: item.productId,
            productName: item.productName,
            productSku: item.productSku,
            quantity: item.quantity,
            costPrice: item.costPrice,
            total: item.quantity * item.costPrice
          }))
        }
      },
      include: { items: true }
    });
    if (receipt.status === "completed") {
      const method = await getCostPriceMethod(prisma2);
      for (const item of receipt.items) {
        const productBefore = await prisma2.product.findUnique({ where: { id: item.productId } });
        const currentStock = productBefore?.stock ?? 0;
        const currentCostPrice = productBefore?.costPrice ?? 0;
        const newCostPrice = calculateCostPrice(method, {
          productId: item.productId,
          currentStock,
          currentCostPrice,
          transactionQty: item.quantity,
          transactionUnitPrice: item.costPrice || 0
        });
        await prisma2.product.update({
          where: { id: item.productId },
          data: {
            stock: { increment: item.quantity },
            costPrice: newCostPrice
          }
        });
        await prisma2.inventoryTransaction.create({
          data: {
            type: "import",
            productId: item.productId,
            productName: item.productName,
            productSku: item.productSku,
            quantity: item.quantity,
            reason: `Nh\u1EADp kho theo phi\u1EBFu ${code}`,
            referenceId: code,
            referenceType: "import_receipt",
            unitPrice: item.costPrice || 0,
            costPriceAfter: newCostPrice,
            supplierId: receiptData.supplierId || null,
            supplierName: receiptData.supplierName || null,
            userId: user.userId || user.id,
            userName
          }
        });
      }
    }
    res.status(201).json({
      success: true,
      data: { ...receipt, createdAt: receipt.createdAt.toISOString(), updatedAt: receipt.updatedAt.toISOString() }
    });
  } catch (err) {
    console.error("Create import receipt error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router35.put("/:id/complete", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const receipt = await prisma2.importReceipt.findUnique({
      where: { id: String(req.params.id) },
      include: { items: true }
    });
    if (!receipt) {
      res.status(404).json({ success: false, error: "Not found" });
      return;
    }
    if (receipt.status !== "draft") {
      res.status(400).json({ success: false, error: "Only drafts can be completed" });
      return;
    }
    const user = req.user;
    const dbUser = await prisma2.user.findUnique({ where: { id: user.userId || user.id } });
    const userName = dbUser?.name || user.email || "Unknown";
    const method = await getCostPriceMethod(prisma2);
    for (const item of receipt.items) {
      const productBefore = await prisma2.product.findUnique({ where: { id: item.productId } });
      const currentStock = productBefore?.stock ?? 0;
      const currentCostPrice = productBefore?.costPrice ?? 0;
      const newCostPrice = calculateCostPrice(method, {
        productId: item.productId,
        currentStock,
        currentCostPrice,
        transactionQty: item.quantity,
        transactionUnitPrice: item.costPrice || 0
      });
      await prisma2.product.update({
        where: { id: item.productId },
        data: {
          stock: { increment: item.quantity },
          costPrice: newCostPrice
        }
      });
      await prisma2.inventoryTransaction.create({
        data: {
          type: "import",
          productId: item.productId,
          productName: item.productName,
          productSku: item.productSku,
          quantity: item.quantity,
          reason: `Nh\u1EADp kho theo phi\u1EBFu ${receipt.code}`,
          referenceId: receipt.code,
          referenceType: "import_receipt",
          unitPrice: item.costPrice || 0,
          costPriceAfter: newCostPrice,
          supplierId: receipt.supplierId,
          supplierName: receipt.supplierName,
          userId: user.userId || user.id,
          userName
        }
      });
    }
    const updated = await prisma2.importReceipt.update({
      where: { id: String(req.params.id) },
      data: { status: "completed" },
      include: { items: true }
    });
    res.json({
      success: true,
      data: { ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() }
    });
  } catch (err) {
    console.error("Complete import receipt error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router35.put("/:id/cancel", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const receipt = await prisma2.importReceipt.findUnique({ where: { id: String(req.params.id) } });
    if (!receipt) {
      res.status(404).json({ success: false, error: "Not found" });
      return;
    }
    if (receipt.status !== "draft") {
      res.status(400).json({ success: false, error: "Only drafts can be cancelled" });
      return;
    }
    const updated = await prisma2.importReceipt.update({
      where: { id: String(req.params.id) },
      data: { status: "cancelled" },
      include: { items: true }
    });
    res.json({
      success: true,
      data: { ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() }
    });
  } catch (err) {
    console.error("Cancel import receipt error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router35.put("/:id/return", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const receipt = await prisma2.importReceipt.findUnique({
      where: { id: String(req.params.id) },
      include: { items: true }
    });
    if (!receipt) {
      res.status(404).json({ success: false, error: "Not found" });
      return;
    }
    if (receipt.status !== "completed" && receipt.status !== "partial_return") {
      res.status(400).json({ success: false, error: "Ch\u1EC9 c\xF3 th\u1EC3 tr\u1EA3 h\xE0ng phi\u1EBFu \u0111\xE3 ho\xE0n th\xE0nh" });
      return;
    }
    const user = req.user;
    const dbUser = await prisma2.user.findUnique({ where: { id: user.userId || user.id } });
    const userName = dbUser?.name || user.email || "Unknown";
    const returnItems = req.body.items;
    if (!returnItems || returnItems.length === 0) {
      res.status(400).json({ success: false, error: "Vui l\xF2ng ch\u1ECDn s\u1EA3n ph\u1EA9m c\u1EA7n tr\u1EA3" });
      return;
    }
    let totalReturnCost = 0;
    let totalReturnQty = 0;
    for (const ri of returnItems) {
      const receiptItem = receipt.items.find((i) => i.productId === ri.productId);
      if (!receiptItem) {
        res.status(400).json({ success: false, error: `S\u1EA3n ph\u1EA9m ${ri.productId} kh\xF4ng c\xF3 trong phi\u1EBFu` });
        return;
      }
      if (ri.quantity <= 0 || ri.quantity > receiptItem.quantity) {
        res.status(400).json({ success: false, error: `S\u1ED1 l\u01B0\u1EE3ng tr\u1EA3 kh\xF4ng h\u1EE3p l\u1EC7 cho ${receiptItem.productName}` });
        return;
      }
      const product = await prisma2.product.findUnique({ where: { id: ri.productId } });
      if (product) {
        const newStock = Math.max(0, product.stock - ri.quantity);
        await prisma2.product.update({
          where: { id: ri.productId },
          data: { stock: newStock }
        });
      }
      totalReturnCost += receiptItem.costPrice * ri.quantity;
      totalReturnQty += ri.quantity;
      await prisma2.inventoryTransaction.create({
        data: {
          type: "export",
          productId: ri.productId,
          productName: receiptItem.productName,
          productSku: receiptItem.productSku,
          quantity: -ri.quantity,
          reason: ri.reason || `Tr\u1EA3 h\xE0ng nh\u1EADp theo phi\u1EBFu ${receipt.code}`,
          referenceId: receipt.code,
          referenceType: "import_return",
          unitPrice: receiptItem.costPrice,
          supplierId: receipt.supplierId,
          supplierName: receipt.supplierName,
          userId: user.userId || user.id,
          userName
        }
      });
    }
    const totalOriginalQty = receipt.items.reduce((s, i) => s + i.quantity, 0);
    const isFullReturn = totalReturnQty >= totalOriginalQty;
    const newStatus = isFullReturn ? "returned" : "partial_return";
    const updated = await prisma2.importReceipt.update({
      where: { id: String(req.params.id) },
      data: { status: newStatus },
      include: { items: true }
    });
    res.json({
      success: true,
      data: {
        ...updated,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        returnedQty: totalReturnQty,
        returnedCost: totalReturnCost
      }
    });
  } catch (err) {
    console.error("Return import receipt error:", err?.message || err);
    res.status(500).json({ success: false, error: "Internal server error", detail: err?.message });
  }
});
router35.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const receipt = await prisma2.importReceipt.findUnique({
      where: { id: String(req.params.id) },
      include: { items: true }
    });
    if (!receipt) {
      res.status(404).json({ success: false, error: "Not found" });
      return;
    }
    if (receipt.status === "completed") {
      const method = await getCostPriceMethod(prisma2);
      for (const item of receipt.items) {
        const product = await prisma2.product.findUnique({ where: { id: item.productId } });
        if (product) {
          const newStock = Math.max(0, product.stock - item.quantity);
          let newCostPrice = product.costPrice;
          if (method === "average" && newStock > 0) {
            const totalValue = product.costPrice * product.stock - item.costPrice * item.quantity;
            newCostPrice = Math.round(totalValue / newStock);
          }
          await prisma2.product.update({
            where: { id: item.productId },
            data: {
              stock: newStock,
              costPrice: newStock > 0 ? newCostPrice : product.costPrice
            }
          });
        }
      }
      await prisma2.inventoryTransaction.deleteMany({
        where: { referenceId: receipt.code, referenceType: "import_receipt" }
      });
    }
    await prisma2.importReceipt.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true, message: "Deleted" });
  } catch (err) {
    console.error("Delete import receipt error:", err?.message || err);
    console.error("Delete import receipt stack:", err?.stack);
    res.status(500).json({ success: false, error: "Internal server error", detail: err?.message });
  }
});
var importReceipts_default = router35;

// src/routes/storeSettings.ts
var import_express36 = require("express");
var router36 = (0, import_express36.Router)();
var DEFAULT_SHIFT_CONFIG = {
  morning: { start: "08:00", end: "14:00" },
  afternoon: { start: "14:00", end: "20:00" },
  evening: { start: "20:00", end: "23:00" }
};
router36.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const store = await prisma2.storeSettings.findFirst();
    let shiftConfig = DEFAULT_SHIFT_CONFIG;
    if (store?.shiftConfig) {
      try {
        shiftConfig = JSON.parse(store.shiftConfig);
      } catch {
      }
    }
    let plan = "full";
    let addOns = [];
    let extraBranches = 0;
    try {
      const storeCode = req.user?.storeCode;
      if (storeCode) {
        const regStore = await registryPrisma.store.findUnique({ where: { code: storeCode } });
        if (regStore) {
          plan = regStore.plan || "full";
          try {
            addOns = JSON.parse(regStore.addOns || "[]");
          } catch {
            addOns = [];
          }
          extraBranches = regStore.extraBranches || 0;
        }
      }
    } catch {
    }
    res.json({
      success: true,
      data: {
        name: store?.name || "",
        address: store?.address || "",
        phone: store?.phone || "",
        logo: store?.logo || "",
        costPriceMethod: store?.costPriceMethod || "fixed",
        trackSerial: store?.trackSerial ?? false,
        trackBatch: store?.trackBatch ?? false,
        allowNegativeStock: store?.allowNegativeStock ?? false,
        shiftConfig,
        notifyLowStock: store?.notifyLowStock ?? true,
        notifyNewOrder: store?.notifyNewOrder ?? true,
        notifyDailyReport: store?.notifyDailyReport ?? false,
        notifyWeeklyReport: store?.notifyWeeklyReport ?? true,
        plan,
        addOns,
        extraBranches
      }
    });
  } catch (err) {
    console.error("Get store settings error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router36.put("/", authMiddleware, requireRole("admin"), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const {
      name,
      address,
      phone,
      logo,
      costPriceMethod,
      trackSerial,
      trackBatch,
      allowNegativeStock,
      shiftConfig,
      notifyLowStock,
      notifyNewOrder,
      notifyDailyReport,
      notifyWeeklyReport
    } = req.body;
    if (costPriceMethod && !["fixed", "average", "lastImport"].includes(costPriceMethod)) {
      res.status(400).json({ success: false, error: "Invalid cost price method" });
      return;
    }
    const data = {};
    if (name !== void 0) data.name = name;
    if (address !== void 0) data.address = address;
    if (phone !== void 0) data.phone = phone;
    if (logo !== void 0) data.logo = logo;
    if (costPriceMethod !== void 0) data.costPriceMethod = costPriceMethod;
    if (trackSerial !== void 0) data.trackSerial = Boolean(trackSerial);
    if (trackBatch !== void 0) data.trackBatch = Boolean(trackBatch);
    if (allowNegativeStock !== void 0) data.allowNegativeStock = Boolean(allowNegativeStock);
    if (shiftConfig !== void 0) data.shiftConfig = JSON.stringify(shiftConfig);
    if (notifyLowStock !== void 0) data.notifyLowStock = Boolean(notifyLowStock);
    if (notifyNewOrder !== void 0) data.notifyNewOrder = Boolean(notifyNewOrder);
    if (notifyDailyReport !== void 0) data.notifyDailyReport = Boolean(notifyDailyReport);
    if (notifyWeeklyReport !== void 0) data.notifyWeeklyReport = Boolean(notifyWeeklyReport);
    const updated = await prisma2.storeSettings.upsert({
      where: { id: "default" },
      create: { id: "default", name: name || "My Store", updatedAt: /* @__PURE__ */ new Date(), ...data },
      update: data
    });
    let parsedShift = DEFAULT_SHIFT_CONFIG;
    if (updated.shiftConfig) {
      try {
        parsedShift = JSON.parse(updated.shiftConfig);
      } catch {
      }
    }
    res.json({ success: true, data: { ...updated, shiftConfig: parsedShift } });
  } catch (err) {
    console.error("Update store settings error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var storeSettings_default = router36;

// src/routes/branches.ts
var import_express37 = require("express");
var router37 = (0, import_express37.Router)();
router37.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchWhere = { status: "active" };
    if (!req.user?.isMainBranch && req.user?.branchId) {
      branchWhere.id = req.user.branchId;
    }
    const data = await prisma2.branch.findMany({
      where: branchWhere,
      orderBy: { createdAt: "asc" }
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error("List branches error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router37.post("/request", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { name, code, address, phone } = req.body;
    if (!name?.trim() || !code?.trim()) {
      return res.status(400).json({ success: false, error: "T\xEAn v\xE0 m\xE3 chi nh\xE1nh l\xE0 b\u1EAFt bu\u1ED9c" });
    }
    const existingBranch = await prisma2.branch.findFirst({
      where: { code: code.trim().toUpperCase() }
    });
    if (existingBranch) {
      return res.status(409).json({ success: false, error: "M\xE3 chi nh\xE1nh \u0111\xE3 t\u1ED3n t\u1EA1i" });
    }
    const existingRequest = await prisma2.branchRequest.findFirst({
      where: { branchCode: code.trim().toUpperCase(), status: "pending" }
    });
    if (existingRequest) {
      return res.status(409).json({ success: false, error: "\u0110\xE3 c\xF3 y\xEAu c\u1EA7u m\u1EDF chi nh\xE1nh v\u1EDBi m\xE3 n\xE0y \u0111ang ch\u1EDD duy\u1EC7t" });
    }
    const store = await prisma2.store.findFirst({ select: { name: true } });
    const user = await prisma2.user.findUnique({ where: { id: req.user.userId }, select: { name: true } });
    const request = await prisma2.branchRequest.create({
      data: {
        storeName: store?.name || "",
        branchName: name.trim(),
        branchCode: code.trim().toUpperCase(),
        address: address?.trim() || null,
        phone: phone?.trim() || null,
        requestedBy: req.user.userId,
        requestedByName: user?.name || ""
      }
    });
    res.status(201).json({
      success: true,
      data: request,
      message: "Y\xEAu c\u1EA7u m\u1EDF chi nh\xE1nh \u0111\xE3 \u0111\u01B0\u1EE3c g\u1EEDi, vui l\xF2ng ch\u1EDD superadmin duy\u1EC7t"
    });
  } catch (err) {
    console.error("Create branch request error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router37.get("/requests", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const requests = await prisma2.branchRequest.findMany({
      where: {},
      orderBy: { createdAt: "desc" }
    });
    res.json({ success: true, data: requests });
  } catch (err) {
    console.error("List branch requests error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router37.post("/", authMiddleware, async (_req, res) => {
  res.status(403).json({
    success: false,
    error: "T\u1EA1o chi nh\xE1nh tr\u1EF1c ti\u1EBFp \u0111\xE3 b\u1ECB v\xF4 hi\u1EC7u h\xF3a. Vui l\xF2ng s\u1EED d\u1EE5ng POST /api/branches/request \u0111\u1EC3 g\u1EEDi y\xEAu c\u1EA7u, admin s\u1EBD duy\u1EC7t."
  });
});
router37.put("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const id = req.params.id;
    const { name, code, address, phone, status } = req.body;
    const existing = await prisma2.branch.findFirst({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, error: "Not found" });
    const data = {};
    if (name !== void 0) data.name = name.trim();
    if (code !== void 0) data.code = code.trim().toUpperCase();
    if (address !== void 0) data.address = address;
    if (phone !== void 0) data.phone = phone;
    if (status !== void 0) data.status = status;
    const updated = await prisma2.branch.update({ where: { id }, data });
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error("Update branch error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router37.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const id = req.params.id;
    const existing = await prisma2.branch.findFirst({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, error: "Not found" });
    if (existing.isMainBranch) {
      return res.status(403).json({
        success: false,
        error: "Kh\xF4ng th\u1EC3 x\xF3a chi nh\xE1nh ch\xEDnh. Chi nh\xE1nh ch\xEDnh l\xE0 b\u1EAFt bu\u1ED9c cho m\u1ED7i c\u1EEDa h\xE0ng."
      });
    }
    const store = await prisma2.store.findFirst({ select: { name: true } });
    const user = await prisma2.user.findUnique({ where: { id: req.user.userId }, select: { name: true } });
    const deleteRequest = await prisma2.branchDeleteRequest.create({
      data: {
        branchId: id,
        branchName: existing.name,
        branchCode: existing.code,
        storeName: store?.name || "",
        requestedBy: req.user.userId,
        requestedByName: user?.name || "",
        reason: req.body?.reason || null
      }
    });
    res.json({
      success: true,
      data: deleteRequest,
      message: "Y\xEAu c\u1EA7u x\xF3a chi nh\xE1nh \u0111\xE3 \u0111\u01B0\u1EE3c g\u1EEDi, vui l\xF2ng ch\u1EDD admin duy\u1EC7t."
    });
  } catch (err) {
    console.error("Delete branch request error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var branches_default = router37;

// src/routes/priceLists.ts
var import_express38 = require("express");
var router38 = (0, import_express38.Router)();
router38.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const lists = await prisma2.priceList.findMany({
      include: { rules: { orderBy: { priority: "asc" } } },
      orderBy: { createdAt: "desc" }
    });
    res.json({ success: true, data: lists });
  } catch (err) {
    console.error("Get price lists error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router38.get("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const list = await prisma2.priceList.findUnique({
      where: { id: String(req.params.id) },
      include: { rules: { orderBy: { priority: "asc" } } }
    });
    if (!list) {
      res.status(404).json({ success: false, error: "Not found" });
      return;
    }
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router38.post("/", authMiddleware, requireRole("admin", "manager"), validate(CreatePriceListSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { name, description, currency, isDefault, active } = req.body;
    if (!name?.trim()) {
      res.status(400).json({ success: false, error: "Name required" });
      return;
    }
    if (isDefault) {
      await prisma2.priceList.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    }
    const list = await prisma2.priceList.create({
      data: {
        name: name.trim(),
        description: description || null,
        currency: currency || "VND",
        isDefault: isDefault || false,
        active: active !== false
      },
      include: { rules: true }
    });
    res.status(201).json({ success: true, data: list });
  } catch (err) {
    console.error("Create price list error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router38.put("/:id", authMiddleware, requireRole("admin", "manager"), validate(UpdatePriceListSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const plId = String(req.params.id);
    const { name, description, currency, isDefault, active } = req.body;
    const data = {};
    if (name !== void 0) data.name = name;
    if (description !== void 0) data.description = description;
    if (currency !== void 0) data.currency = currency;
    if (active !== void 0) data.active = active;
    if (isDefault !== void 0) {
      data.isDefault = isDefault;
      if (isDefault) {
        await prisma2.priceList.updateMany({ where: { isDefault: true, NOT: { id: plId } }, data: { isDefault: false } });
      }
    }
    const list = await prisma2.priceList.update({
      where: { id: plId },
      data,
      include: { rules: true }
    });
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router38.delete("/:id", authMiddleware, requireRole("admin", "manager"), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const plId = String(req.params.id);
    const list = await prisma2.priceList.findUnique({ where: { id: plId } });
    if (list?.isDefault) {
      res.status(400).json({ success: false, error: "Cannot delete default price list" });
      return;
    }
    await prisma2.priceList.delete({ where: { id: plId } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router38.post("/:id/rules", authMiddleware, requireRole("admin", "manager"), validate(CreatePriceRuleSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const plId = String(req.params.id);
    const { name, type, value, scope, scopeIds, appliesTo, priority, startDate, endDate, customerGroup, minQty, note } = req.body;
    const rule = await prisma2.priceRule.create({
      data: {
        priceListId: plId,
        name: name.trim(),
        type: type || "discount",
        value: Number(value) || 0,
        scope: scope || "all",
        scopeIds: scopeIds ? JSON.stringify(scopeIds) : null,
        appliesTo: appliesTo || "sellingPrice",
        priority: Number(priority) || 1,
        startDate: startDate ? new Date(startDate) : /* @__PURE__ */ new Date(),
        endDate: endDate ? new Date(endDate) : null,
        active: true,
        customerGroup: customerGroup || null,
        minQty: minQty ? Number(minQty) : null,
        note: note || null
      }
    });
    res.status(201).json({ success: true, data: rule });
  } catch (err) {
    console.error("Create price rule error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router38.put("/rules/:ruleId", authMiddleware, requireRole("admin", "manager"), validate(UpdatePriceRuleSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const ruleId = String(req.params.ruleId);
    const { name, type, value, scope, scopeIds, appliesTo, priority, startDate, endDate, active, customerGroup, minQty, note } = req.body;
    const data = {};
    if (name !== void 0) data.name = name;
    if (type !== void 0) data.type = type;
    if (value !== void 0) data.value = Number(value);
    if (scope !== void 0) data.scope = scope;
    if (scopeIds !== void 0) data.scopeIds = JSON.stringify(scopeIds);
    if (appliesTo !== void 0) data.appliesTo = appliesTo;
    if (priority !== void 0) data.priority = Number(priority);
    if (startDate !== void 0) data.startDate = new Date(startDate);
    if (endDate !== void 0) data.endDate = endDate ? new Date(endDate) : null;
    if (active !== void 0) data.active = active;
    if (customerGroup !== void 0) data.customerGroup = customerGroup;
    if (minQty !== void 0) data.minQty = minQty ? Number(minQty) : null;
    if (note !== void 0) data.note = note;
    const rule = await prisma2.priceRule.update({ where: { id: ruleId }, data });
    res.json({ success: true, data: rule });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router38.delete("/rules/:ruleId", authMiddleware, requireRole("admin", "manager"), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    await prisma2.priceRule.delete({ where: { id: String(req.params.ruleId) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var priceLists_default = router38;

// src/routes/admin.ts
var import_express39 = require("express");
var router39 = (0, import_express39.Router)();
var ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY) {
  console.warn("\u26A0\uFE0F ADMIN_KEY not configured \u2014 admin routes will reject all requests");
}
function adminKeyAuth(req, res, next) {
  if (!ADMIN_KEY) {
    res.status(503).json({ success: false, error: "Admin API not configured" });
    return;
  }
  const key = req.headers["x-admin-key"];
  if (!key || key !== ADMIN_KEY) {
    res.status(403).json({ success: false, error: "Unauthorized" });
    return;
  }
  next();
}
router39.use(adminKeyAuth);
var prisma = registryPrisma;
router39.get("/stats", async (_req, res) => {
  try {
    const now = /* @__PURE__ */ new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const [totalStores, activeStores, suspendedStores, newStoresThisMonth, allStores] = await Promise.all([
      prisma.store.count(),
      prisma.store.count({ where: { status: "active" } }),
      prisma.store.count({ where: { status: { in: ["suspended", "inactive"] } } }),
      prisma.store.count({ where: { createdAt: { gte: startOfMonth } } }),
      prisma.store.findMany({ select: { schema: true } })
    ]);
    let totalUsers = 0;
    let totalBranches = 0;
    await Promise.all(allStores.map(async (s) => {
      try {
        const sp = getStorePrisma(s.schema);
        const [uCount, bCount] = await Promise.all([
          sp.user.count(),
          sp.branch.count()
        ]);
        totalUsers += uCount;
        totalBranches += bCount;
      } catch {
      }
    }));
    res.json({ success: true, data: { totalStores, activeStores, suspendedStores, newStoresThisMonth, totalUsers, totalBranches } });
  } catch (err) {
    console.error("Admin stats error:", err);
    res.status(500).json({ success: false, error: "Internal server error", detail: err?.message || String(err) });
  }
});
router39.get("/stores", async (req, res) => {
  try {
    const search = req.query.search || "";
    const status = req.query.status || "all";
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, parseInt(req.query.pageSize) || 20);
    const skip2 = (page - 1) * pageSize;
    const where = {};
    if (status && status !== "all") where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } }
      ];
    }
    const [rawItems, total] = await Promise.all([
      prisma.store.findMany({ where, orderBy: { createdAt: "desc" }, skip: skip2, take: pageSize }),
      prisma.store.count({ where })
    ]);
    const items = await Promise.all(rawItems.map(async (store) => {
      let branchCount = 0;
      let userCount = 0;
      let branches = [];
      try {
        const sp = getStorePrisma(store.schema);
        const [bList, uCount] = await Promise.all([
          sp.branch.findMany({ select: { id: true, name: true, code: true, status: true }, take: 10 }),
          sp.user.count()
        ]);
        branches = bList;
        branchCount = bList.length;
        userCount = uCount;
      } catch {
      }
      return { ...store, branchCount, userCount, branches };
    }));
    res.json({ success: true, data: { items, total, page, pageSize } });
  } catch (err) {
    console.error("Admin list stores error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router39.get("/stores/:id", async (req, res) => {
  try {
    const store = await prisma.store.findUnique({ where: { id: String(req.params.id) } });
    if (!store) return res.status(404).json({ success: false, error: "C\u1EEDa h\xE0ng kh\xF4ng t\u1ED3n t\u1EA1i" });
    const storePrisma = getStorePrisma(store.schema);
    const [users, branches] = await Promise.all([
      storePrisma.user.findMany({ select: { id: true, name: true, email: true, role: true, employeeStatus: true } }),
      storePrisma.branch.findMany({ select: { id: true, name: true, code: true, status: true, address: true } })
    ]);
    res.json({ success: true, data: { ...store, users, branches } });
  } catch (err) {
    console.error("Admin store detail error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router39.put("/stores/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    if (!["active", "inactive", "suspended"].includes(status)) {
      return res.status(400).json({ success: false, error: "Tr\u1EA1ng th\xE1i kh\xF4ng h\u1EE3p l\u1EC7" });
    }
    const store = await prisma.store.findUnique({ where: { id: String(req.params.id) } });
    if (!store) return res.status(404).json({ success: false, error: "C\u1EEDa h\xE0ng kh\xF4ng t\u1ED3n t\u1EA1i" });
    const updated = await prisma.store.update({ where: { id: String(req.params.id) }, data: { status } });
    console.log(`[Admin] Store ${store.code} status \u2192 ${status}`);
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error("Admin update status error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router39.delete("/stores/:id", async (req, res) => {
  try {
    const store = await prisma.store.findUnique({ where: { id: String(req.params.id) } });
    if (!store) return res.status(404).json({ success: false, error: "C\u1EEDa h\xE0ng kh\xF4ng t\u1ED3n t\u1EA1i" });
    await dropStoreSchema(store.schema);
    await prisma.store.delete({ where: { id: store.id } });
    console.log(`[Admin] Deleted store ${store.code} (schema: ${store.schema})`);
    res.json({ success: true, message: `\u0110\xE3 x\xF3a c\u1EEDa h\xE0ng "${store.name}"` });
  } catch (err) {
    console.error("Admin delete store error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router39.get("/users", async (_req, res) => {
  try {
    const stores = await prisma.store.findMany();
    const allUsers = [];
    await Promise.all(stores.map(async (store) => {
      try {
        const sp = getStorePrisma(store.schema);
        const users = await sp.user.findMany({ include: { branch: { select: { name: true } } } });
        users.forEach((u) => allUsers.push({
          ...u,
          storeName: store.name,
          storeCode: store.code,
          _storeSchema: store.schema,
          branchName: u.branch?.name || null
        }));
      } catch {
      }
    }));
    res.json({ success: true, data: allUsers });
  } catch (err) {
    console.error("Admin list users error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router39.put("/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { password, phone, email } = req.body;
    const stores = await prisma.store.findMany();
    let found = false;
    for (const store of stores) {
      try {
        const sp = getStorePrisma(store.schema);
        const user = await sp.user.findUnique({ where: { id: String(id) } });
        if (user) {
          const data = {};
          if (password) {
            const bcrypt5 = await import("bcryptjs");
            data.password = await bcrypt5.hash(password, 10);
          }
          if (phone !== void 0) data.phone = phone;
          if (email !== void 0) data.email = email;
          await sp.user.update({ where: { id: String(id) }, data });
          found = true;
          break;
        }
      } catch {
      }
    }
    if (!found) return res.status(404).json({ success: false, error: "User not found" });
    res.json({ success: true, message: "\u0110\xE3 c\u1EADp nh\u1EADt" });
  } catch (err) {
    console.error("Admin update user error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router39.post("/stores/:id/branches", async (req, res) => {
  try {
    const store = await prisma.store.findUnique({ where: { id: String(req.params.id) } });
    if (!store) return res.status(404).json({ success: false, error: "Store not found" });
    const sp = getStorePrisma(store.schema);
    const { name, code, address, phone } = req.body;
    if (!name || !code) return res.status(400).json({ success: false, error: "T\xEAn v\xE0 m\xE3 b\u1EAFt bu\u1ED9c" });
    const branch = await sp.branch.create({
      data: { name, code, address: address || null, phone: phone || null, status: "active" }
    });
    res.json({ success: true, data: branch });
  } catch (err) {
    if (err?.code === "P2002") return res.status(409).json({ success: false, error: "M\xE3 chi nh\xE1nh \u0111\xE3 t\u1ED3n t\u1EA1i" });
    console.error("Admin add branch error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router39.put("/branches/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const stores = await prisma.store.findMany();
    for (const store of stores) {
      try {
        const sp = getStorePrisma(store.schema);
        const branch = await sp.branch.findUnique({ where: { id: String(id) } });
        if (branch) {
          await sp.branch.update({ where: { id: String(id) }, data: req.body });
          return res.json({ success: true, message: "\u0110\xE3 c\u1EADp nh\u1EADt chi nh\xE1nh" });
        }
      } catch {
      }
    }
    res.status(404).json({ success: false, error: "Branch not found" });
  } catch (err) {
    console.error("Admin update branch error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router39.delete("/branches/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const stores = await prisma.store.findMany();
    for (const store of stores) {
      try {
        const sp = getStorePrisma(store.schema);
        const branch = await sp.branch.findUnique({ where: { id: String(id) } });
        if (branch) {
          await sp.branch.delete({ where: { id: String(id) } });
          return res.json({ success: true, message: "\u0110\xE3 x\xF3a chi nh\xE1nh" });
        }
      } catch {
      }
    }
    res.status(404).json({ success: false, error: "Branch not found" });
  } catch (err) {
    console.error("Admin delete branch error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router39.get("/branch-requests", async (req, res) => {
  try {
    const statusFilter = req.query.status || "all";
    const stores = await prisma.store.findMany();
    const allRequests = [];
    await Promise.all(stores.map(async (store) => {
      try {
        const sp = getStorePrisma(store.schema);
        const rows = await sp.$queryRawUnsafe(
          `SELECT * FROM "BranchRequest" ${statusFilter !== "all" ? `WHERE "status" = $1` : ""} ORDER BY "createdAt" DESC`,
          ...statusFilter === "all" ? [] : [statusFilter]
        ).catch(() => []);
        rows.forEach((r) => allRequests.push({ ...r, storeName: store.name, storeCode: store.code, _storeSchema: store.schema }));
      } catch {
      }
    }));
    allRequests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ success: true, data: allRequests });
  } catch (err) {
    console.error("Admin list branch requests error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router39.put("/branch-requests/:id/approve", async (req, res) => {
  try {
    const { id } = req.params;
    const stores = await prisma.store.findMany();
    for (const store of stores) {
      try {
        const sp = getStorePrisma(store.schema);
        const rows = await sp.$queryRawUnsafe(`SELECT * FROM "BranchRequest" WHERE "id" = $1`, id);
        if (rows.length > 0) {
          const request = rows[0];
          await sp.$executeRawUnsafe(`UPDATE "BranchRequest" SET "status" = 'approved', "updatedAt" = NOW() WHERE "id" = $1`, id);
          await sp.branch.create({
            data: {
              name: request.branchName || request.name || "Chi nh\xE1nh m\u1EDBi",
              code: request.branchCode || request.code || `${store.code}-CN${Date.now()}`,
              address: request.address || null,
              phone: request.phone || null,
              status: "active"
            }
          });
          try {
            await sp.notification.create({
              data: { title: "\u2705 Y\xEAu c\u1EA7u m\u1EDF chi nh\xE1nh \u0111\xE3 \u0111\u01B0\u1EE3c duy\u1EC7t", message: `Chi nh\xE1nh "${request.branchName || request.name}" \u0111\xE3 \u0111\u01B0\u1EE3c t\u1EA1o.`, type: "success" }
            });
          } catch {
          }
          return res.json({ success: true, message: "\u0110\xE3 duy\u1EC7t v\xE0 t\u1EA1o chi nh\xE1nh" });
        }
      } catch {
      }
    }
    res.status(404).json({ success: false, error: "Request not found" });
  } catch (err) {
    console.error("Admin approve branch request error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router39.put("/branch-requests/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const stores = await prisma.store.findMany();
    for (const store of stores) {
      try {
        const sp = getStorePrisma(store.schema);
        const rows = await sp.$queryRawUnsafe(`SELECT * FROM "BranchRequest" WHERE "id" = $1`, id);
        if (rows.length > 0) {
          await sp.$executeRawUnsafe(
            `UPDATE "BranchRequest" SET "status" = 'rejected', "rejectedReason" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
            reason || "",
            id
          );
          try {
            await sp.notification.create({
              data: { title: "\u274C Y\xEAu c\u1EA7u m\u1EDF chi nh\xE1nh b\u1ECB t\u1EEB ch\u1ED1i", message: `Y\xEAu c\u1EA7u m\u1EDF chi nh\xE1nh \u0111\xE3 b\u1ECB t\u1EEB ch\u1ED1i.${reason ? ` L\xFD do: ${reason}` : ""}`, type: "warning" }
            });
          } catch {
          }
          return res.json({ success: true, message: "\u0110\xE3 t\u1EEB ch\u1ED1i" });
        }
      } catch {
      }
    }
    res.status(404).json({ success: false, error: "Request not found" });
  } catch (err) {
    console.error("Admin reject branch request error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router39.get("/branch-delete-requests", async (req, res) => {
  try {
    const statusFilter = req.query.status || "all";
    const stores = await prisma.store.findMany();
    const allRequests = [];
    await Promise.all(stores.map(async (store) => {
      try {
        const sp = getStorePrisma(store.schema);
        const rows = await sp.$queryRawUnsafe(
          `SELECT * FROM "BranchDeleteRequest" ${statusFilter !== "all" ? `WHERE "status" = $1` : ""} ORDER BY "createdAt" DESC`,
          ...statusFilter === "all" ? [] : [statusFilter]
        ).catch(() => []);
        rows.forEach((r) => allRequests.push({ ...r, storeName: store.name, storeCode: store.code, _storeSchema: store.schema }));
      } catch {
      }
    }));
    allRequests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ success: true, data: allRequests });
  } catch (err) {
    console.error("Admin list branch delete requests error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router39.put("/branch-delete-requests/:id/approve", async (req, res) => {
  try {
    const { id } = req.params;
    const stores = await prisma.store.findMany();
    for (const store of stores) {
      try {
        const sp = getStorePrisma(store.schema);
        const rows = await sp.$queryRawUnsafe(`SELECT * FROM "BranchDeleteRequest" WHERE "id" = $1`, id);
        if (rows.length > 0) {
          const request = rows[0];
          await sp.$executeRawUnsafe(`UPDATE "BranchDeleteRequest" SET "status" = 'approved', "updatedAt" = NOW() WHERE "id" = $1`, id);
          try {
            if (request.branchId) await sp.branch.delete({ where: { id: String(request.branchId) } });
          } catch {
          }
          try {
            await sp.notification.create({
              data: { title: "\u2705 Y\xEAu c\u1EA7u x\xF3a chi nh\xE1nh \u0111\xE3 \u0111\u01B0\u1EE3c duy\u1EC7t", message: `Chi nh\xE1nh "${request.branchName || ""}" \u0111\xE3 \u0111\u01B0\u1EE3c x\xF3a.`, type: "success" }
            });
          } catch {
          }
          return res.json({ success: true, message: "\u0110\xE3 duy\u1EC7t x\xF3a chi nh\xE1nh" });
        }
      } catch {
      }
    }
    res.status(404).json({ success: false, error: "Request not found" });
  } catch (err) {
    console.error("Admin approve branch delete request error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router39.put("/branch-delete-requests/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const stores = await prisma.store.findMany();
    for (const store of stores) {
      try {
        const sp = getStorePrisma(store.schema);
        const rows = await sp.$queryRawUnsafe(`SELECT * FROM "BranchDeleteRequest" WHERE "id" = $1`, id);
        if (rows.length > 0) {
          await sp.$executeRawUnsafe(
            `UPDATE "BranchDeleteRequest" SET "status" = 'rejected', "rejectedReason" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
            reason || "",
            id
          );
          try {
            await sp.notification.create({
              data: { title: "\u274C Y\xEAu c\u1EA7u x\xF3a chi nh\xE1nh b\u1ECB t\u1EEB ch\u1ED1i", message: `Y\xEAu c\u1EA7u x\xF3a chi nh\xE1nh \u0111\xE3 b\u1ECB t\u1EEB ch\u1ED1i.${reason ? ` L\xFD do: ${reason}` : ""}`, type: "warning" }
            });
          } catch {
          }
          return res.json({ success: true, message: "\u0110\xE3 t\u1EEB ch\u1ED1i" });
        }
      } catch {
      }
    }
    res.status(404).json({ success: false, error: "Request not found" });
  } catch (err) {
    console.error("Admin reject branch delete request error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
if (process.env.NODE_ENV === "development") {
  router39.post("/reset-db", async (_req, res) => {
    try {
      console.log("\u26A0\uFE0F RESET DB: Deleting all stores and their schemas...");
      const stores = await prisma.store.findMany();
      for (const store of stores) {
        try {
          await dropStoreSchema(store.schema);
          console.log(`  \u{1F5D1}\uFE0F Dropped: ${store.schema}`);
        } catch {
        }
      }
      await prisma.store.deleteMany({});
      console.log("\u2705 All stores deleted");
      res.json({ success: true, message: "Database reset complete", deleted: stores.length });
    } catch (err) {
      console.error("Reset DB error:", err);
      res.status(500).json({ success: false, error: err?.message || "Reset failed" });
    }
  });
} else {
  router39.post("/reset-db", (_req, res) => {
    res.status(403).json({ success: false, error: "This endpoint is disabled in production" });
  });
}
router39.post("/migrate", async (_req, res) => {
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "plan" TEXT NOT NULL DEFAULT 'full'`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "addOns" TEXT NOT NULL DEFAULT '[]'`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "extraBranches" INTEGER NOT NULL DEFAULT 0`);
    res.json({ success: true, message: "Migration complete \u2014 plan, addOns, extraBranches added to Store" });
  } catch (err) {
    console.error("Migration error:", err);
    res.status(500).json({ success: false, error: err?.message || "Migration failed" });
  }
});
router39.get("/upgrade-requests", async (req, res) => {
  try {
    const statusFilter = req.query.status || "all";
    const allStores = await prisma.store.findMany({ select: { code: true, name: true, schema: true } });
    const allRequests = [];
    await Promise.all(allStores.map(async (store) => {
      try {
        const sp = getStorePrisma(store.schema);
        const rows = await sp.$queryRawUnsafe(
          statusFilter === "all" ? `SELECT * FROM "UpgradeRequest" ORDER BY "createdAt" DESC` : `SELECT * FROM "UpgradeRequest" WHERE "status" = $1 ORDER BY "createdAt" DESC`,
          ...statusFilter === "all" ? [] : [statusFilter]
        ).catch(() => []);
        rows.forEach((r) => allRequests.push({ ...r, _storeSchema: store.schema }));
      } catch {
      }
    }));
    allRequests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ success: true, data: allRequests });
  } catch (err) {
    console.error("Admin list upgrade requests error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router39.put("/upgrade-requests/:storeCode/:id/approve", async (req, res) => {
  try {
    const { storeCode, id } = req.params;
    const store = await prisma.store.findUnique({ where: { code: String(storeCode) } });
    if (!store) return res.status(404).json({ success: false, error: "Store not found" });
    const sp = getStorePrisma(store.schema);
    await sp.$executeRawUnsafe(
      `UPDATE "UpgradeRequest" SET "status" = 'approved', "updatedAt" = NOW() WHERE "id" = $1`,
      id
    );
    const rows = await sp.$queryRawUnsafe(`SELECT * FROM "UpgradeRequest" WHERE "id" = $1`, id);
    const request = rows[0];
    if (request) {
      await prisma.store.update({
        where: { code: String(storeCode) },
        data: {
          plan: request.requestedPlan,
          addOns: request.addOns || "[]",
          extraBranches: request.extraBranches || 0
        }
      });
      const addOns = typeof request.addOns === "string" ? (() => {
        try {
          return JSON.parse(request.addOns);
        } catch {
          return [];
        }
      })() : request.addOns || [];
      if (Array.isArray(addOns) && addOns.includes("extra_branch") && request.extraBranches > 0) {
        const existingBranches = await sp.branch.count();
        for (let i = 0; i < request.extraBranches; i++) {
          const branchNum = existingBranches + i + 1;
          try {
            await sp.branch.create({
              data: {
                name: `Chi nh\xE1nh ${branchNum}`,
                code: `${storeCode}-CN${branchNum}`,
                status: "active"
              }
            });
            console.log(`[Admin] Auto-created branch: ${storeCode}-CN${branchNum}`);
          } catch (branchErr) {
            console.error(`[Admin] Failed to create branch ${branchNum}:`, branchErr);
          }
        }
      }
      console.log(`[Admin] Approved upgrade: ${storeCode} \u2192 ${request.requestedPlan}`);
      try {
        const planNames = { retail: "B\xE1n L\u1EBB", wholesale: "B\xE1n S\u1EC9", full: "\u0110\u1EA7y \u0110\u1EE7" };
        await sp.notification.create({
          data: {
            title: "\u2705 Y\xEAu c\u1EA7u n\xE2ng c\u1EA5p \u0111\xE3 \u0111\u01B0\u1EE3c duy\u1EC7t",
            message: `G\xF3i d\u1ECBch v\u1EE5 c\u1EE7a b\u1EA1n \u0111\xE3 \u0111\u01B0\u1EE3c n\xE2ng c\u1EA5p l\xEAn ${planNames[request.requestedPlan] || request.requestedPlan}${request.extraBranches > 0 ? `. ${request.extraBranches} chi nh\xE1nh m\u1EDBi \u0111\xE3 \u0111\u01B0\u1EE3c t\u1EA1o.` : ""}`,
            type: "success"
          }
        });
      } catch {
      }
    }
    res.json({ success: true, message: "\u0110\xE3 duy\u1EC7t y\xEAu c\u1EA7u n\xE2ng c\u1EA5p" });
  } catch (err) {
    console.error("Admin approve upgrade error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router39.put("/upgrade-requests/:storeCode/:id/reject", async (req, res) => {
  try {
    const { storeCode, id } = req.params;
    const { reason } = req.body;
    const store = await prisma.store.findUnique({ where: { code: String(storeCode) } });
    if (!store) return res.status(404).json({ success: false, error: "Store not found" });
    const sp = getStorePrisma(store.schema);
    await sp.$executeRawUnsafe(
      `UPDATE "UpgradeRequest" SET "status" = 'rejected', "rejectedReason" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
      reason || "",
      id
    );
    console.log(`[Admin] Rejected upgrade: ${storeCode} (reason: ${reason || "none"})`);
    try {
      await sp.notification.create({
        data: {
          title: "\u274C Y\xEAu c\u1EA7u n\xE2ng c\u1EA5p b\u1ECB t\u1EEB ch\u1ED1i",
          message: `Y\xEAu c\u1EA7u n\xE2ng c\u1EA5p g\xF3i d\u1ECBch v\u1EE5 \u0111\xE3 b\u1ECB t\u1EEB ch\u1ED1i.${reason ? ` L\xFD do: ${reason}` : ""}`,
          type: "warning"
        }
      });
    } catch {
    }
    res.json({ success: true, message: "\u0110\xE3 t\u1EEB ch\u1ED1i y\xEAu c\u1EA7u n\xE2ng c\u1EA5p" });
  } catch (err) {
    console.error("Admin reject upgrade error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router39.post("/sync-schemas", async (_req, res) => {
  try {
    const stores = await prisma.store.findMany({ select: { id: true, name: true, schema: true, code: true } });
    const results = [];
    for (const store of stores) {
      try {
        const base = (process.env.DATABASE_URL || "").replace(/[?&]schema=[^&]*/g, "").replace(/\?$/, "");
        const sep = base.includes("?") ? "&" : "?";
        const schemaUrl = `${base}${sep}schema=${store.schema}`;
        const { execSync: execSync2 } = require("child_process");
        execSync2("npx prisma db push --schema=prisma/schema-store.prisma --skip-generate --accept-data-loss", {
          stdio: "pipe",
          env: { ...process.env, STORE_DATABASE_URL: schemaUrl, DATABASE_URL: schemaUrl },
          timeout: 3e4
        });
        results.push({ store: store.code, schema: store.schema, status: "ok" });
        console.log(`\u2705 Schema synced: ${store.code} (${store.schema})`);
      } catch (err) {
        results.push({ store: store.code, schema: store.schema, status: `error: ${err?.message?.slice(0, 100)}` });
        console.error(`\u274C Schema sync failed: ${store.code}`, err?.message?.slice(0, 200));
      }
    }
    res.json({ success: true, synced: results.filter((r) => r.status === "ok").length, total: stores.length, results });
  } catch (err) {
    console.error("Sync schemas error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var admin_default = router39;

// src/routes/importData.ts
var import_express40 = require("express");
var import_multer = __toESM(require("multer"));
var XLSX = __toESM(require("xlsx"));
function getPrisma(req) {
  if (!req.storePrisma) throw new Error("Kh\xF4ng t\xECm th\u1EA5y k\u1EBFt n\u1ED1i database. Vui l\xF2ng \u0111\u0103ng nh\u1EADp l\u1EA1i.");
  return req.storePrisma;
}
var router40 = (0, import_express40.Router)();
var upload = (0, import_multer.default)({ storage: import_multer.default.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
function setupSSE(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
    // nginx
  });
  res.flushHeaders();
}
function sendProgress(res, data) {
  const progress = data.total > 0 ? Math.round(data.current / data.total * 100) : 0;
  res.write(`data: ${JSON.stringify({ ...data, progress })}

`);
}
function sendDone(res, data) {
  res.write(`data: ${JSON.stringify({ ...data, progress: 100, done: true })}

`);
  res.end();
}
function sendError(res, error) {
  res.write(`data: ${JSON.stringify({ error, done: true })}

`);
  res.end();
}
async function resolveBranchId(req) {
  const branchId = req.body?.branchId || getBranchId(req);
  if (!branchId) throw new Error("Vui l\xF2ng ch\u1ECDn chi nh\xE1nh tr\u01B0\u1EDBc khi import");
  const branch = await getPrisma(req).branch.findFirst({ where: { id: branchId } });
  if (!branch) throw new Error(`Chi nh\xE1nh kh\xF4ng t\u1ED3n t\u1EA1i ho\u1EB7c kh\xF4ng thu\u1ED9c c\u1EEDa h\xE0ng n\xE0y`);
  return branchId;
}
router40.get("/branches", authMiddleware, async (req, res) => {
  try {
    const branches = await getPrisma(req).branch.findMany({
      where: {},
      select: { id: true, name: true, address: true },
      orderBy: { name: "asc" }
    });
    res.json({ success: true, data: branches });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message || "L\u1ED7i" });
  }
});
var TEMPLATES = {
  products: {
    filename: "mau_san_pham.xlsx",
    headers: [
      "M\xE3 h\xE0ng",
      "T\xEAn h\xE0ng",
      "Nh\xF3m h\xE0ng c\u1EA5p 1",
      "Nh\xF3m h\xE0ng c\u1EA5p 2",
      "Nh\xF3m h\xE0ng c\u1EA5p 3",
      "Th\u01B0\u01A1ng hi\u1EC7u",
      "Gi\xE1 v\u1ED1n",
      "Gi\xE1 b\xE1n",
      "T\u1ED3n \u0111\u1EA7u k\u1EF3",
      "\u0110\u01A1n v\u1ECB",
      "Barcode",
      "H\xECnh 1",
      "H\xECnh 2",
      "H\xECnh 3",
      "H\xECnh 4",
      "H\xECnh 5",
      "H\xECnh 6",
      "H\xECnh 7",
      "H\xECnh 8",
      "H\xECnh 9",
      "H\xECnh 10"
    ],
    sample: [
      [
        "SP001",
        "\xC1o thun nam basic",
        "Th\u1EDDi trang",
        "\xC1o",
        "\xC1o thun",
        "Nike",
        "85000",
        "150000",
        "100",
        "C\xE1i",
        "8901234567890",
        "https://example.com/img/sp001-1.jpg",
        "https://example.com/img/sp001-2.jpg",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
      ]
    ]
  },
  suppliers: {
    filename: "mau_nha_cung_cap.xlsx",
    headers: ["M\xE3 NCC", "T\xEAn NCC", "Ng\u01B0\u1EDDi li\xEAn h\u1EC7", "S\u0110T", "Email", "\u0110\u1ECBa ch\u1EC9", "MST", "Ghi ch\xFA"],
    sample: [["NCC001", "C\xF4ng ty TNHH ABC", "Nguy\u1EC5n V\u0103n X", "0909123456", "abc@company.vn", "123 Nguy\u1EC5n Hu\u1EC7, Q1", "0312345678", ""]]
  },
  transactions: {
    filename: "mau_don_hang.xlsx",
    headers: ["M\xE3 \u0111\u01A1n", "Ng\xE0y gi\u1EDD", "Kh\xE1ch h\xE0ng", "S\u0110T", "M\xE3 h\xE0ng", "T\xEAn h\xE0ng", "S\u1ED1 l\u01B0\u1EE3ng", "\u0110\u01A1n gi\xE1", "Gi\u1EA3m gi\xE1", "Ghi ch\xFA"],
    sample: [["DH001", "28/02/2026 14:30", "Nguy\u1EC5n V\u0103n A", "0901234567", "SP001", "\xC1o thun", "2", "150000", "0", ""]]
  },
  "import-receipts": {
    filename: "mau_nhap_hang.xlsx",
    headers: ["M\xE3 phi\u1EBFu", "Ng\xE0y gi\u1EDD", "Nh\xE0 cung c\u1EA5p", "M\xE3 h\xE0ng", "T\xEAn h\xE0ng", "S\u1ED1 l\u01B0\u1EE3ng", "\u0110\u01A1n gi\xE1", "Ghi ch\xFA"],
    sample: [["PN001", "28/02/2026 10:00", "C\xF4ng ty ABC", "SP001", "\xC1o thun", "50", "85000", ""]]
  },
  returns: {
    filename: "mau_tra_hang.xlsx",
    headers: ["M\xE3 tr\u1EA3 h\xE0ng", "Ng\xE0y gi\u1EDD", "M\xE3 \u0111\u01A1n g\u1ED1c", "Kh\xE1ch h\xE0ng", "S\u0110T", "L\xFD do", "M\xE3 h\xE0ng", "T\xEAn h\xE0ng", "S\u1ED1 l\u01B0\u1EE3ng", "\u0110\u01A1n gi\xE1", "Ghi ch\xFA"],
    sample: [["TH001", "28/02/2026 09:15", "DH001", "Nguy\u1EC5n V\u0103n A", "0901234567", "L\u1ED7i", "SP001", "\xC1o thun", "1", "150000", ""]]
  },
  customers: {
    filename: "mau_khach_hang.xlsx",
    headers: ["M\xE3 KH", "T\xEAn kh\xE1ch h\xE0ng", "S\u0110T", "Email", "\u0110\u1ECBa ch\u1EC9", "Nh\xF3m KH", "Ng\xE0y sinh", "Gi\u1EDBi t\xEDnh", "Ghi ch\xFA", "C\xF4ng n\u1EE3"],
    sample: [["KH001", "Nguy\u1EC5n V\u0103n A", "0901234567", "a@email.com", "123 L\xEA L\u1EE3i", "VIP", "15/06/1990", "Nam", "", "0"]]
  }
};
router40.get("/template/:type", (req, res) => {
  const template = TEMPLATES[req.params.type];
  if (!template) return res.status(404).json({ success: false, error: "Template kh\xF4ng t\u1ED3n t\u1EA1i" });
  const data = [template.headers, ...template.sample];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = template.headers.map((h) => ({ wch: Math.max(h.length * 2, 15) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "D\u1EEF li\u1EC7u");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${template.filename}"`);
  res.send(buf);
});
function parseExcel(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", codepage: 65001 });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}
function col(row, ...names) {
  for (const name of names) {
    if (row[name] !== void 0 && row[name] !== "") return String(row[name]).trim();
    const key = Object.keys(row).find((k) => k.toLowerCase().trim() === name.toLowerCase().trim());
    if (key && row[key] !== void 0 && row[key] !== "") return String(row[key]).trim();
  }
  return "";
}
function toNumber(val) {
  if (!val) return 0;
  const cleaned = String(val).replace(/[^\d.,\-]/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}
async function findOrCreateCategory(prisma2, level1, level2, level3) {
  if (!level1) {
    let def = await prisma2.category.findFirst({ where: { name: "Chung", level: 1 } });
    if (!def) def = await prisma2.category.create({ data: { name: "Chung", level: 1 } });
    return def.id;
  }
  let cat1 = await prisma2.category.findFirst({ where: { name: level1, level: 1, parentId: null } });
  if (!cat1) cat1 = await prisma2.category.create({ data: { name: level1, level: 1 } });
  if (!level2) return cat1.id;
  let cat2 = await prisma2.category.findFirst({ where: { name: level2, level: 2, parentId: cat1.id } });
  if (!cat2) cat2 = await prisma2.category.create({ data: { name: level2, level: 2, parentId: cat1.id } });
  if (!level3) return cat2.id;
  let cat3 = await prisma2.category.findFirst({ where: { name: level3, level: 3, parentId: cat2.id } });
  if (!cat3) cat3 = await prisma2.category.create({ data: { name: level3, level: 3, parentId: cat2.id } });
  return cat3.id;
}
async function findOrCreateBrand(prisma2, name) {
  if (!name) return null;
  let brand = await prisma2.brand.findFirst({ where: { name } });
  if (!brand) brand = await prisma2.brand.create({ data: { name } });
  return brand.id;
}
function parseDateTime(str, defaultHour, defaultMin) {
  if (!str) {
    const d2 = /* @__PURE__ */ new Date();
    d2.setHours(defaultHour, defaultMin, 0, 0);
    return d2;
  }
  const match = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (match) return new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]), parseInt(match[4]), parseInt(match[5]), parseInt(match[6] || "0"));
  const parts = str.split(/[\/\-\.]/);
  if (parts.length === 3 && parseInt(parts[2]) > 100)
    return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]), defaultHour, defaultMin);
  const d = /* @__PURE__ */ new Date();
  d.setHours(defaultHour, defaultMin, 0, 0);
  return d;
}
router40.post("/products", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: "Vui l\xF2ng upload file Excel" });
    let rows = parseExcel(req.file.buffer);
    if (!rows.length) return res.status(400).json({ success: false, error: "File Excel tr\u1ED1ng" });
    const branchId = await resolveBranchId(req);
    const useSSE = req.query.stream === "true";
    if (useSSE) setupSSE(res);
    let imported = 0;
    const errors = [];
    console.log(`[ImportData] Products: ${rows.length} rows, branchId=${branchId}, sse=${useSSE}`);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = col(row, "T\xEAn h\xE0ng", "T\xEAn s\u1EA3n ph\u1EA9m", "name", "product_name", "ten_hang", "T\xEAn H\xE0ng", "T\xEAn");
      if (!name) {
        errors.push(`D\xF2ng ${i + 2}: Thi\u1EBFu t\xEAn s\u1EA3n ph\u1EA9m`);
        continue;
      }
      const sku = col(row, "M\xE3 h\xE0ng", "M\xE3 s\u1EA3n ph\u1EA9m", "SKU", "code", "sku", "product_code", "ma_hang", "M\xE3 H\xE0ng") || `SP-${Date.now()}-${i}`;
      const catLevel1 = col(row, "Nh\xF3m h\xE0ng c\u1EA5p 1", "Nh\xF3m 1", "Danh m\u1EE5c", "category", "Category");
      const catLevel2 = col(row, "Nh\xF3m h\xE0ng c\u1EA5p 2", "Nh\xF3m 2", "Danh m\u1EE5c con");
      const catLevel3 = col(row, "Nh\xF3m h\xE0ng c\u1EA5p 3", "Nh\xF3m 3", "Danh m\u1EE5c chi ti\u1EBFt");
      const brandName = col(row, "Th\u01B0\u01A1ng hi\u1EC7u", "Brand", "Nh\xE3n hi\u1EC7u", "thuong_hieu");
      const costPrice = toNumber(col(row, "Gi\xE1 v\u1ED1n", "Gi\xE1 nh\u1EADp", "cost", "cost_price", "gia_von", "Gi\xE1 V\u1ED1n"));
      const sellingPrice = toNumber(col(row, "Gi\xE1 b\xE1n", "Gi\xE1 b\xE1n l\u1EBB", "price", "sale_price", "gia_ban", "Gi\xE1 B\xE1n"));
      const openingStock = Math.round(toNumber(col(row, "T\u1ED3n \u0111\u1EA7u k\u1EF3", "T\u1ED3n \u0111\u1EA7u", "opening_stock", "ton_dau_ky", "T\u1ED3n kho", "stock", "quantity", "ton_kho", "T\u1ED3n Kho", "S\u1ED1 l\u01B0\u1EE3ng")));
      const baseUnit = col(row, "\u0110\u01A1n v\u1ECB", "\u0110VT", "unit", "don_vi", "\u0110\u01A1n V\u1ECB") || "C\xE1i";
      const barcode = col(row, "Barcode", "M\xE3 v\u1EA1ch", "barcode", "ma_vach") || null;
      const imageUrls = [];
      for (let j = 1; j <= 10; j++) {
        const url = col(row, `H\xECnh ${j}`, `Image ${j}`, `image_${j}`, `hinh_${j}`, `\u1EA2nh ${j}`);
        if (url && (url.startsWith("http://") || url.startsWith("https://"))) imageUrls.push(url);
      }
      try {
        const categoryId = await findOrCreateCategory(getPrisma(req), catLevel1, catLevel2, catLevel3);
        const brandId = await findOrCreateBrand(getPrisma(req), brandName);
        const existing = await getPrisma(req).product.findFirst({ where: { sku } });
        const productData = {
          name,
          costPrice,
          sellingPrice,
          stock: openingStock,
          minStock: 0,
          baseUnit,
          barcode,
          categoryId,
          ...brandId ? { brandId } : {}
        };
        let product;
        if (existing) {
          const { stock, ...updateData } = productData;
          product = await getPrisma(req).product.update({ where: { id: existing.id }, data: updateData });
        } else {
          product = await getPrisma(req).product.create({ data: { sku, ...productData } });
        }
        if (openingStock > 0) {
          await getPrisma(req).inventoryTransaction.create({
            data: {
              type: "stocktaking",
              productId: product.id,
              productName: name,
              productSku: sku,
              quantity: openingStock,
              reason: "T\u1ED3n \u0111\u1EA7u k\u1EF3 - Import",
              referenceType: "adjustment",
              referenceId: `IMP-${sku}`,
              branchId,
              userName: "System Import"
            }
          });
        }
        if (imageUrls.length > 0) {
          await getPrisma(req).productImage.deleteMany({ where: { productId: product.id } });
          await getPrisma(req).productImage.createMany({
            data: imageUrls.map((url, idx) => ({ productId: product.id, url, isPrimary: idx === 0 }))
          });
        }
        imported++;
      } catch (err) {
        errors.push(`D\xF2ng ${i + 2}: ${err?.message?.slice(0, 80) || "L\u1ED7i"}`);
      }
      if (useSSE && (i % 10 === 0 || i === rows.length - 1)) {
        sendProgress(res, { current: i + 1, total: rows.length, imported, errors: errors.length, message: `\u0110ang x\u1EED l\xFD: ${name}` });
      }
    }
    console.log(`[ImportData] Products result: imported=${imported}, total=${rows.length}, errors=${errors.length}`);
    if (useSSE) {
      sendDone(res, { imported, total: rows.length, errors: errors.slice(0, 10) });
    } else {
      res.json({ success: true, imported, total: rows.length, errors: errors.slice(0, 10) });
    }
  } catch (err) {
    console.error("[ImportData] Products error:", err);
    if (req.query.stream === "true") {
      sendError(res, err?.message || "Import th\u1EA5t b\u1EA1i");
    } else {
      res.status(500).json({ success: false, error: err?.message || "Import th\u1EA5t b\u1EA1i" });
    }
  }
});
router40.post("/transactions", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: "Vui l\xF2ng upload file Excel" });
    const rows = parseExcel(req.file.buffer);
    if (!rows.length) return res.status(400).json({ success: false, error: "File Excel tr\u1ED1ng" });
    const branchId = await resolveBranchId(req);
    const userId = req.user?.userId;
    if (!userId) return res.status(400).json({ success: false, error: "Kh\xF4ng x\xE1c \u0111\u1ECBnh \u0111\u01B0\u1EE3c user" });
    const grouped = /* @__PURE__ */ new Map();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const receiptNumber = col(row, "M\xE3 \u0111\u01A1n", "M\xE3 h\xF3a \u0111\u01A1n", "receipt_number", "M\xE3 \u0110\u01A1n") || `TXN-IMP-${Date.now()}-${i}`;
      if (!grouped.has(receiptNumber)) grouped.set(receiptNumber, []);
      grouped.get(receiptNumber).push(row);
    }
    const useSSE = req.query.stream === "true";
    if (useSSE) setupSSE(res);
    let imported = 0;
    const errors = [];
    let orderIdx = 0;
    for (const [receiptNumber, itemRows] of grouped) {
      try {
        const firstRow = itemRows[0];
        const customerName = col(firstRow, "Kh\xE1ch h\xE0ng", "T\xEAn KH", "customer", "Kh\xE1ch H\xE0ng") || null;
        const customerPhone = col(firstRow, "S\u0110T", "S\u1ED1 \u0111i\u1EC7n tho\u1EA1i", "phone") || null;
        const discount = toNumber(col(firstRow, "Gi\u1EA3m gi\xE1", "Chi\u1EBFt kh\u1EA5u", "discount"));
        const notes = col(firstRow, "Ghi ch\xFA", "notes") || null;
        const dateStr = col(firstRow, "Ng\xE0y gi\u1EDD", "Ng\xE0y", "Th\u1EDDi gian", "Date", "DateTime", "ngay_gio");
        const createdAt = dateStr ? parseDateTime(dateStr, 12, 0) : /* @__PURE__ */ new Date();
        const itemsData = [];
        for (const row of itemRows) {
          const sku = col(row, "M\xE3 h\xE0ng", "SKU", "M\xE3 s\u1EA3n ph\u1EA9m", "sku");
          if (!sku) continue;
          const product = await getPrisma(req).product.findFirst({ where: { sku } });
          if (!product) {
            errors.push(`M\xE3 h\xE0ng "${sku}" kh\xF4ng t\u1ED3n t\u1EA1i`);
            continue;
          }
          const qty = Math.round(toNumber(col(row, "S\u1ED1 l\u01B0\u1EE3ng", "SL", "quantity", "S\u1ED1 L\u01B0\u1EE3ng")));
          const price = toNumber(col(row, "\u0110\u01A1n gi\xE1", "Gi\xE1 b\xE1n", "unit_price", "\u0110\u01A1n Gi\xE1")) || product.sellingPrice;
          if (qty <= 0) continue;
          itemsData.push({ productId: product.id, productName: product.name, sku, quantity: qty, unitPrice: price, lineTotal: qty * price });
        }
        if (itemsData.length === 0) {
          orderIdx++;
          continue;
        }
        const subtotal = itemsData.reduce((s, i) => s + i.lineTotal, 0);
        const total = subtotal - discount;
        await getPrisma(req).transaction.create({
          data: {
            receiptNumber,
            customerName,
            customerPhone,
            subtotal,
            discount,
            total,
            branchId: branchId || null,
            status: "completed",
            createdBy: userId,
            notes,
            createdAt,
            items: { create: itemsData }
          }
        });
        for (const item of itemsData) {
          await getPrisma(req).product.update({ where: { id: item.productId }, data: { stock: { decrement: item.quantity } } });
        }
        imported++;
      } catch (err) {
        errors.push(`\u0110\u01A1n ${receiptNumber}: ${err?.message?.slice(0, 80) || "L\u1ED7i"}`);
      }
      orderIdx++;
      if (useSSE) sendProgress(res, { current: orderIdx, total: grouped.size, imported, errors: errors.length, message: `\u0110ang x\u1EED l\xFD \u0111\u01A1n: ${receiptNumber}` });
    }
    if (useSSE) {
      sendDone(res, { imported, total: grouped.size, errors: errors.slice(0, 10) });
    } else {
      res.json({ success: true, imported, total: grouped.size, errors: errors.slice(0, 10) });
    }
  } catch (err) {
    console.error("[ImportData] Transactions error:", err);
    if (req.query.stream === "true") {
      sendError(res, err?.message || "Import th\u1EA5t b\u1EA1i");
    } else {
      res.status(500).json({ success: false, error: err?.message || "Import th\u1EA5t b\u1EA1i" });
    }
  }
});
router40.post("/import-receipts", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: "Vui l\xF2ng upload file Excel" });
    const rows = parseExcel(req.file.buffer);
    if (!rows.length) return res.status(400).json({ success: false, error: "File Excel tr\u1ED1ng" });
    const branchId = await resolveBranchId(req);
    const userId = req.user?.userId;
    if (!userId) return res.status(400).json({ success: false, error: "Kh\xF4ng x\xE1c \u0111\u1ECBnh \u0111\u01B0\u1EE3c user" });
    const grouped = /* @__PURE__ */ new Map();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const code = col(row, "M\xE3 phi\u1EBFu", "M\xE3 nh\u1EADp", "receipt_code", "M\xE3 Phi\u1EBFu") || `IR-IMP-${Date.now()}-${i}`;
      if (!grouped.has(code)) grouped.set(code, []);
      grouped.get(code).push(row);
    }
    const useSSE = req.query.stream === "true";
    if (useSSE) setupSSE(res);
    let imported = 0;
    const errors = [];
    let orderIdx = 0;
    for (const [code, itemRows] of grouped) {
      try {
        const firstRow = itemRows[0];
        const supplierName = col(firstRow, "Nh\xE0 cung c\u1EA5p", "NCC", "supplier") || "NCC ch\u01B0a x\xE1c \u0111\u1ECBnh";
        const note = col(firstRow, "Ghi ch\xFA", "notes") || null;
        const dateStr = col(firstRow, "Ng\xE0y gi\u1EDD", "Ng\xE0y", "Th\u1EDDi gian", "Date", "DateTime", "ngay_gio");
        const createdAt = dateStr ? parseDateTime(dateStr, 10, 0) : /* @__PURE__ */ new Date();
        const itemsData = [];
        for (const row of itemRows) {
          const sku = col(row, "M\xE3 h\xE0ng", "SKU", "M\xE3 s\u1EA3n ph\u1EA9m", "sku");
          if (!sku) continue;
          const product = await getPrisma(req).product.findFirst({ where: { sku } });
          if (!product) {
            errors.push(`M\xE3 h\xE0ng "${sku}" kh\xF4ng t\u1ED3n t\u1EA1i`);
            continue;
          }
          const qty = Math.round(toNumber(col(row, "S\u1ED1 l\u01B0\u1EE3ng", "SL", "quantity", "S\u1ED1 L\u01B0\u1EE3ng")));
          const price = toNumber(col(row, "\u0110\u01A1n gi\xE1", "Gi\xE1 nh\u1EADp", "unit_price", "\u0110\u01A1n Gi\xE1")) || product.costPrice;
          if (qty <= 0) continue;
          itemsData.push({ productId: product.id, productName: product.name, productSku: sku, quantity: qty, costPrice: price, total: qty * price });
        }
        if (itemsData.length === 0) {
          orderIdx++;
          continue;
        }
        const totalCost = itemsData.reduce((s, i) => s + i.total, 0);
        const totalItems = itemsData.reduce((s, i) => s + i.quantity, 0);
        await getPrisma(req).importReceipt.create({
          data: {
            code,
            supplierName,
            totalCost,
            totalItems,
            branchId: branchId || null,
            status: "completed",
            note,
            userId,
            userName: "Import",
            createdAt,
            items: { create: itemsData }
          }
        });
        for (const item of itemsData) {
          await getPrisma(req).product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
        }
        imported++;
      } catch (err) {
        errors.push(`Phi\u1EBFu ${code}: ${err?.message?.slice(0, 80) || "L\u1ED7i"}`);
      }
      orderIdx++;
      if (useSSE) sendProgress(res, { current: orderIdx, total: grouped.size, imported, errors: errors.length, message: `\u0110ang x\u1EED l\xFD phi\u1EBFu: ${code}` });
    }
    if (useSSE) {
      sendDone(res, { imported, total: grouped.size, errors: errors.slice(0, 10) });
    } else {
      res.json({ success: true, imported, total: grouped.size, errors: errors.slice(0, 10) });
    }
  } catch (err) {
    console.error("[ImportData] ImportReceipts error:", err);
    if (req.query.stream === "true") sendError(res, err?.message || "Import th\u1EA5t b\u1EA1i");
    else res.status(500).json({ success: false, error: err?.message || "Import th\u1EA5t b\u1EA1i" });
  }
});
router40.post("/returns", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: "Vui l\xF2ng upload file Excel" });
    const rows = parseExcel(req.file.buffer);
    if (!rows.length) return res.status(400).json({ success: false, error: "File Excel tr\u1ED1ng" });
    const branchId = await resolveBranchId(req);
    const grouped = /* @__PURE__ */ new Map();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const code = col(row, "M\xE3 tr\u1EA3 h\xE0ng", "M\xE3 phi\u1EBFu", "return_code", "M\xE3 Tr\u1EA3 H\xE0ng") || `RTN-IMP-${Date.now()}-${i}`;
      if (!grouped.has(code)) grouped.set(code, []);
      grouped.get(code).push(row);
    }
    const useSSE = req.query.stream === "true";
    if (useSSE) setupSSE(res);
    let imported = 0;
    const errors = [];
    let orderIdx = 0;
    for (const [code, itemRows] of grouped) {
      try {
        const firstRow = itemRows[0];
        const originalInvoice = col(firstRow, "M\xE3 \u0111\u01A1n g\u1ED1c", "H\xF3a \u0111\u01A1n g\u1ED1c", "original_invoice") || "N/A";
        const reason = col(firstRow, "L\xFD do", "L\xFD do tr\u1EA3", "reason") || "Import t\u1EEB h\u1EC7 th\u1ED1ng c\u0169";
        const customerName = col(firstRow, "Kh\xE1ch h\xE0ng", "T\xEAn KH", "customer") || "Kh\xE1ch l\u1EBB";
        const customerPhone = col(firstRow, "S\u0110T", "S\u1ED1 \u0111i\u1EC7n tho\u1EA1i", "phone") || null;
        const notes = col(firstRow, "Ghi ch\xFA", "notes") || null;
        const dateStr = col(firstRow, "Ng\xE0y gi\u1EDD", "Ng\xE0y", "Th\u1EDDi gian", "Date", "DateTime", "ngay_gio");
        const createdAt = dateStr ? parseDateTime(dateStr, 9, 0) : /* @__PURE__ */ new Date();
        const itemsList = [];
        for (const row of itemRows) {
          const sku = col(row, "M\xE3 h\xE0ng", "SKU", "M\xE3 s\u1EA3n ph\u1EA9m", "sku");
          if (!sku) continue;
          const product = await getPrisma(req).product.findFirst({ where: { sku } });
          if (!product) {
            errors.push(`M\xE3 h\xE0ng "${sku}" kh\xF4ng t\u1ED3n t\u1EA1i`);
            continue;
          }
          const qty = Math.round(toNumber(col(row, "S\u1ED1 l\u01B0\u1EE3ng", "SL", "quantity", "S\u1ED1 L\u01B0\u1EE3ng")));
          const price = toNumber(col(row, "\u0110\u01A1n gi\xE1", "Gi\xE1 b\xE1n", "unit_price", "\u0110\u01A1n Gi\xE1")) || product.sellingPrice;
          if (qty <= 0) continue;
          itemsList.push({ sku, name: product.name, quantity: qty, unitPrice: price, total: qty * price, productId: product.id });
        }
        if (itemsList.length === 0) {
          orderIdx++;
          continue;
        }
        const totalRefund = itemsList.reduce((s, i) => s + i.total, 0);
        await getPrisma(req).returnOrder.create({
          data: {
            code,
            originalInvoice,
            customerName,
            customerPhone,
            reason,
            notes,
            status: "refunded",
            branchId: branchId || null,
            items: JSON.stringify(itemsList),
            totalRefund,
            createdAt
          }
        });
        for (const item of itemsList) {
          await getPrisma(req).product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
        }
        imported++;
      } catch (err) {
        errors.push(`Phi\u1EBFu ${code}: ${err?.message?.slice(0, 80) || "L\u1ED7i"}`);
      }
      orderIdx++;
      if (useSSE) sendProgress(res, { current: orderIdx, total: grouped.size, imported, errors: errors.length, message: `\u0110ang x\u1EED l\xFD tr\u1EA3 h\xE0ng: ${code}` });
    }
    if (useSSE) {
      sendDone(res, { imported, total: grouped.size, errors: errors.slice(0, 10) });
    } else {
      res.json({ success: true, imported, total: grouped.size, errors: errors.slice(0, 10) });
    }
  } catch (err) {
    console.error("[ImportData] Returns error:", err);
    if (req.query.stream === "true") sendError(res, err?.message || "Import th\u1EA5t b\u1EA1i");
    else res.status(500).json({ success: false, error: err?.message || "Import th\u1EA5t b\u1EA1i" });
  }
});
router40.post("/customers", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: "Vui l\xF2ng upload file Excel" });
    const rows = parseExcel(req.file.buffer);
    if (!rows.length) return res.status(400).json({ success: false, error: "File Excel tr\u1ED1ng" });
    const useSSE = req.query.stream === "true";
    if (useSSE) setupSSE(res);
    let imported = 0;
    const errors = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = col(row, "T\xEAn kh\xE1ch h\xE0ng", "T\xEAn KH", "T\xEAn", "name", "customer_name");
      const phone = col(row, "S\u0110T", "S\u1ED1 \u0111i\u1EC7n tho\u1EA1i", "Phone", "phone", "sdt");
      if (!name || !phone) {
        errors.push(`D\xF2ng ${i + 2}: Thi\u1EBFu t\xEAn ho\u1EB7c S\u0110T`);
        continue;
      }
      const code = col(row, "M\xE3 KH", "M\xE3 kh\xE1ch h\xE0ng", "code", "customer_code") || `KH-${Date.now()}-${i}`;
      const email = col(row, "Email", "email") || null;
      const address = col(row, "\u0110\u1ECBa ch\u1EC9", "Address", "dia_chi") || null;
      const groupName = col(row, "Nh\xF3m KH", "Nh\xF3m kh\xE1ch h\xE0ng", "group", "nhom_kh");
      const birthday = col(row, "Ng\xE0y sinh", "Birthday", "ngay_sinh") || null;
      const genderRaw = col(row, "Gi\u1EDBi t\xEDnh", "Gender", "gioi_tinh") || null;
      const notes = col(row, "Ghi ch\xFA", "Notes", "ghi_chu") || null;
      const debt = toNumber(col(row, "C\xF4ng n\u1EE3", "N\u1EE3", "Debt", "cong_no"));
      let gender = null;
      if (genderRaw) {
        const g = genderRaw.toLowerCase();
        if (g.includes("nam") || g === "male") gender = "male";
        else if (g.includes("n\u1EEF") || g === "female") gender = "female";
        else gender = "other";
      }
      try {
        let groupId = null;
        if (groupName) {
          let group = await getPrisma(req).customerGroup.findFirst({ where: { name: groupName } });
          if (!group) group = await getPrisma(req).customerGroup.create({ data: { name: groupName } });
          groupId = group.id;
        }
        const existing = await getPrisma(req).customer.findFirst({ where: { code } });
        const customerData = {
          name,
          phone,
          email,
          address,
          birthday,
          gender,
          notes,
          debt,
          ...groupId ? { groupId } : {}
        };
        if (existing) {
          await getPrisma(req).customer.update({ where: { id: existing.id }, data: customerData });
        } else {
          await getPrisma(req).customer.create({ data: { code, ...customerData } });
        }
        imported++;
      } catch (err) {
        errors.push(`D\xF2ng ${i + 2}: ${err?.message?.slice(0, 80) || "L\u1ED7i"}`);
      }
      if (useSSE && (i % 5 === 0 || i === rows.length - 1)) {
        sendProgress(res, { current: i + 1, total: rows.length, imported, errors: errors.length, message: `\u0110ang x\u1EED l\xFD: ${name}` });
      }
    }
    if (useSSE) {
      sendDone(res, { imported, total: rows.length, errors: errors.slice(0, 10) });
    } else {
      res.json({ success: true, imported, total: rows.length, errors: errors.slice(0, 10) });
    }
  } catch (err) {
    console.error("[ImportData] Customers error:", err);
    if (req.query.stream === "true") sendError(res, err?.message || "Import th\u1EA5t b\u1EA1i");
    else res.status(500).json({ success: false, error: err?.message || "Import th\u1EA5t b\u1EA1i" });
  }
});
router40.post("/suppliers", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: "Vui l\xF2ng upload file Excel" });
    const rows = parseExcel(req.file.buffer);
    if (!rows.length) return res.status(400).json({ success: false, error: "File Excel tr\u1ED1ng" });
    const useSSE = req.query.stream === "true";
    if (useSSE) setupSSE(res);
    let imported = 0;
    const errors = [];
    console.log(`[ImportData] Suppliers: ${rows.length} rows`);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = col(row, "T\xEAn NCC", "T\xEAn nh\xE0 cung c\u1EA5p", "Nh\xE0 cung c\u1EA5p", "name", "supplier_name");
      if (!name) {
        errors.push(`D\xF2ng ${i + 2}: Thi\u1EBFu t\xEAn nh\xE0 cung c\u1EA5p`);
        continue;
      }
      const code = col(row, "M\xE3 NCC", "M\xE3 nh\xE0 cung c\u1EA5p", "code", "supplier_code") || `NCC-${Date.now()}-${i}`;
      const contactName = col(row, "Ng\u01B0\u1EDDi li\xEAn h\u1EC7", "Li\xEAn h\u1EC7", "contact", "contact_name") || null;
      const phone = col(row, "S\u0110T", "S\u1ED1 \u0111i\u1EC7n tho\u1EA1i", "Phone", "phone", "sdt") || null;
      const email = col(row, "Email", "email") || null;
      const address = col(row, "\u0110\u1ECBa ch\u1EC9", "Address", "dia_chi") || null;
      const taxCode = col(row, "MST", "M\xE3 s\u1ED1 thu\u1EBF", "Tax", "tax_code", "ma_so_thue") || null;
      const notes = col(row, "Ghi ch\xFA", "Notes", "ghi_chu") || null;
      try {
        const existing = await getPrisma(req).supplier.findFirst({ where: { code } });
        const supplierData = { name, contactName, phone, email, address, taxCode, notes };
        if (existing) {
          await getPrisma(req).supplier.update({ where: { id: existing.id }, data: supplierData });
        } else {
          await getPrisma(req).supplier.create({ data: { code, ...supplierData } });
        }
        imported++;
      } catch (err) {
        errors.push(`D\xF2ng ${i + 2}: ${err?.message?.slice(0, 80) || "L\u1ED7i"}`);
      }
      if (useSSE && (i % 5 === 0 || i === rows.length - 1)) {
        sendProgress(res, { current: i + 1, total: rows.length, imported, errors: errors.length, message: `\u0110ang x\u1EED l\xFD: ${name}` });
      }
    }
    console.log(`[ImportData] Suppliers result: imported=${imported}, total=${rows.length}, errors=${errors.length}`);
    if (useSSE) {
      sendDone(res, { imported, total: rows.length, errors: errors.slice(0, 10) });
    } else {
      res.json({ success: true, imported, total: rows.length, errors: errors.slice(0, 10) });
    }
  } catch (err) {
    console.error("[ImportData] Suppliers error:", err);
    if (req.query.stream === "true") sendError(res, err?.message || "Import th\u1EA5t b\u1EA1i");
    else res.status(500).json({ success: false, error: err?.message || "Import th\u1EA5t b\u1EA1i" });
  }
});
var importData_default = router40;

// src/routes/uploads.ts
var import_express41 = require("express");

// src/lib/storage.ts
var import_storage = require("@google-cloud/storage");
var import_crypto2 = __toESM(require("crypto"));
var BUCKET_NAME = process.env.GCS_BUCKET;
var GCS_BASE_URL = process.env.GCS_BASE_URL;
var storage = null;
var bucket = null;
if (BUCKET_NAME) {
  try {
    storage = new import_storage.Storage();
    bucket = storage.bucket(BUCKET_NAME);
    console.log(`\u2705 Cloud Storage enabled (bucket: ${BUCKET_NAME})`);
  } catch (err) {
    console.warn("\u26A0\uFE0F Cloud Storage init failed:", err.message);
  }
} else {
  console.log("\u2139\uFE0F GCS_BUCKET not set \u2014 file upload via signed URLs disabled");
}
async function getSignedUploadUrl(folder, originalName, contentType, expiresMinutes = 15) {
  if (!storage || !bucket || !BUCKET_NAME) {
    throw new Error("Cloud Storage not configured (set GCS_BUCKET env var)");
  }
  const ext = originalName.split(".").pop() || "";
  const hash = import_crypto2.default.randomBytes(6).toString("hex");
  const timestamp = Date.now();
  const filename = `${folder}/${timestamp}-${hash}.${ext}`;
  const file = bucket.file(filename);
  const [signedUrl] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + expiresMinutes * 60 * 1e3,
    contentType
  });
  const baseUrl = GCS_BASE_URL || `https://storage.googleapis.com/${BUCKET_NAME}`;
  const publicUrl = `${baseUrl}/${filename}`;
  return {
    uploadUrl: signedUrl,
    publicUrl,
    filename
  };
}
async function deleteFile(filename) {
  if (!bucket) {
    throw new Error("Cloud Storage not configured");
  }
  await bucket.file(filename).delete().catch(() => {
  });
}
function isStorageEnabled() {
  return !!bucket;
}

// src/routes/uploads.ts
var router41 = (0, import_express41.Router)();
router41.get("/status", authMiddleware, (_req, res) => {
  res.json({ success: true, data: { enabled: isStorageEnabled() } });
});
router41.post("/signed-url", authMiddleware, async (req, res) => {
  try {
    const { folder = "general", filename, contentType } = req.body;
    if (!filename || typeof filename !== "string") {
      return res.status(400).json({ success: false, error: "filename is required" });
    }
    if (folder.includes("..") || filename.includes("..")) {
      return res.status(400).json({ success: false, error: "Invalid path" });
    }
    if (!contentType) {
      return res.status(400).json({ success: false, error: "contentType is required" });
    }
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // xlsx
      "application/vnd.ms-excel",
      // xls
      "text/csv"
    ];
    if (!allowed.includes(contentType)) {
      return res.status(400).json({ success: false, error: `Content type '${contentType}' not allowed` });
    }
    const result = await getSignedUploadUrl(folder, filename, contentType);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error("Signed URL error:", err);
    res.status(500).json({ success: false, error: err.message || "Failed to generate signed URL" });
  }
});
router41.delete("/:filename(*)", authMiddleware, requireRole("admin", "manager"), async (req, res) => {
  try {
    const filename = String(req.params.filename);
    if (!filename || filename.includes("..") || filename.startsWith("/")) {
      return res.status(400).json({ success: false, error: "Invalid filename" });
    }
    await deleteFile(String(filename));
    res.json({ success: true, message: "File deleted" });
  } catch (err) {
    console.error("Delete file error:", err);
    res.status(500).json({ success: false, error: err.message || "Failed to delete file" });
  }
});
var uploads_default = router41;

// src/routes/sync.ts
var import_express42 = require("express");
var ensureDataset2;
var insertRows2;
var deleteRowsSince2;
var isBigQueryEnabled2;
try {
  const bq2 = (init_bigquery(), __toCommonJS(bigquery_exports));
  ensureDataset2 = bq2.ensureDataset;
  insertRows2 = bq2.insertRows;
  deleteRowsSince2 = bq2.deleteRowsSince;
  isBigQueryEnabled2 = bq2.isBigQueryEnabled;
} catch {
  isBigQueryEnabled2 = () => false;
}
var router42 = (0, import_express42.Router)();
function checkInternalKey(req) {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) {
    console.warn("\u26A0\uFE0F INTERNAL_API_KEY not configured \u2014 internal routes will reject all requests");
    return false;
  }
  const key = req.headers["x-internal-key"];
  return !!key && key === expected;
}
router42.post("/sync-to-bigquery", async (req, res) => {
  const startTime = Date.now();
  if (!checkInternalKey(req)) {
    return res.status(403).json({ success: false, error: "Unauthorized" });
  }
  if (!isBigQueryEnabled2()) {
    return res.status(400).json({ success: false, error: "BigQuery not configured" });
  }
  try {
    console.log("[Sync] Starting BigQuery ETL sync across all stores...");
    await ensureDataset2();
    const since = new Date(Date.now() - 25 * 60 * 60 * 1e3);
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const result = {};
    const stores = await registryPrisma.store.findMany({ where: { status: "active" } });
    for (const store of stores) {
      try {
        const storePrisma = getStorePrisma(store.schema);
        const transactions = await storePrisma.transaction.findMany({
          where: { createdAt: { gte: since } },
          include: { payments: true }
        });
        const txRows = transactions.map((tx) => ({
          id: tx.id,
          storeCode: store.code,
          branchId: tx.branchId || null,
          receiptNumber: tx.receiptNumber,
          total: tx.total,
          subtotal: tx.subtotal,
          discount: tx.discount,
          status: tx.status,
          paymentMethod: tx.payments?.[0]?.type || "cash",
          createdAt: tx.createdAt.toISOString()
        }));
        if (txRows.length > 0) {
          result[`${store.code}_transactions`] = await insertRows2("transactions", txRows);
        }
        const products = await storePrisma.product.findMany({
          select: { id: true, name: true, sku: true, costPrice: true, sellingPrice: true, stock: true, categoryId: true }
        });
        const productRows = products.map((p) => ({
          id: p.id,
          storeCode: store.code,
          name: p.name,
          sku: p.sku,
          costPrice: p.costPrice,
          sellingPrice: p.sellingPrice,
          stock: p.stock,
          snapshotDate: today
        }));
        if (productRows.length > 0) {
          result[`${store.code}_products`] = await insertRows2("products_snapshot", productRows);
        }
      } catch (err) {
        console.error(`[Sync] Error syncing store ${store.code}:`, err.message);
      }
    }
    const elapsed = ((Date.now() - startTime) / 1e3).toFixed(1);
    console.log(`[Sync] \u2705 ETL complete in ${elapsed}s:`, result);
    res.json({ success: true, data: { synced: result, elapsed: `${elapsed}s`, syncedAt: (/* @__PURE__ */ new Date()).toISOString() } });
  } catch (err) {
    console.error("[Sync] ETL error:", err);
    res.status(500).json({ success: false, error: err.message || "ETL sync failed" });
  }
});
router42.get("/sync-status", (_req, res) => {
  res.json({
    success: true,
    data: {
      bigqueryEnabled: isBigQueryEnabled2(),
      architecture: "multi-schema",
      dataset: process.env.BIGQUERY_DATASET || null
    }
  });
});
var sync_default = router42;

// src/routes/announcements.ts
var import_express43 = require("express");
var router43 = (0, import_express43.Router)();
router43.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { search, priority, archived } = req.query;
    const where = {};
    if (priority && priority !== "all") where.priority = priority;
    if (archived === "true") where.archived = true;
    else if (archived === "false" || !archived) where.archived = false;
    if (search) {
      const q = String(search);
      where.OR = [{ title: { contains: q } }, { content: { contains: q } }];
    }
    const data = await prisma2.announcement.findMany({ where, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }] });
    res.json({ success: true, data });
  } catch (err) {
    console.error("List announcements error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router43.post("/", authMiddleware, validate(CreateAnnouncementSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const { title, content, priority, author } = req.body;
    if (!title?.trim() || !content?.trim()) return res.status(400).json({ success: false, error: "Title and content required" });
    const data = await prisma2.announcement.create({
      data: { branchId, title: title.trim(), content: content.trim(), priority: priority || "info", author: author || "Admin" }
    });
    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error("Create announcement error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router43.put("/:id", authMiddleware, validate(UpdateAnnouncementSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const annId = String(req.params.id);
    const { title, content, priority, pinned, archived } = req.body;
    const data = await prisma2.announcement.update({
      where: { id: annId },
      data: {
        ...title !== void 0 && { title },
        ...content !== void 0 && { content },
        ...priority !== void 0 && { priority },
        ...pinned !== void 0 && { pinned },
        ...archived !== void 0 && { archived }
      }
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error("Update announcement error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router43.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    await prisma2.announcement.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete announcement error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var announcements_default = router43;

// src/routes/attendance.ts
var import_express44 = require("express");
var router44 = (0, import_express44.Router)();
router44.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { userId, date, status } = req.query;
    const where = {};
    if (userId) where.userId = userId;
    if (status && status !== "all") where.status = status;
    if (date) {
      const d = new Date(String(date));
      const start = new Date(d);
      start.setHours(0, 0, 0, 0);
      const end = new Date(d);
      end.setHours(23, 59, 59, 999);
      where.date = { gte: start, lte: end };
    }
    const data = await prisma2.attendance.findMany({ where, orderBy: { date: "desc" } });
    res.json({ success: true, data });
  } catch (err) {
    console.error("List attendance error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router44.post("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const branchId = getBranchId(req);
    const { userId, userName, role, date, note } = req.body;
    if (!userId || !userName) return res.status(400).json({ success: false, error: "userId and userName required" });
    const checkDate = date ? new Date(date) : /* @__PURE__ */ new Date();
    const now = /* @__PURE__ */ new Date();
    const data = await prisma2.attendance.create({
      data: {
        branchId,
        userId,
        userName,
        role: role || null,
        date: checkDate,
        checkIn: now,
        status: "present",
        note: note || null
      }
    });
    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error("Create attendance error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router44.put("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { checkOut, status, note } = req.body;
    const updateData = {};
    if (checkOut) updateData.checkOut = new Date(checkOut);
    if (status) updateData.status = status;
    if (note !== void 0) updateData.note = note;
    const data = await prisma2.attendance.update({ where: { id: String(req.params.id) }, data: updateData });
    res.json({ success: true, data });
  } catch (err) {
    console.error("Update attendance error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router44.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    await prisma2.attendance.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete attendance error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var attendance_default = router44;

// src/routes/loyalty.ts
var import_express45 = require("express");
var router45 = (0, import_express45.Router)();
router45.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { search, tier } = req.query;
    const where = {};
    if (tier && tier !== "all") where.tier = tier;
    if (search) {
      const q = String(search);
      where.OR = [{ name: { contains: q } }, { phone: { contains: q } }];
    }
    const data = await prisma2.loyaltyMember.findMany({
      where,
      include: { transactions: { orderBy: { createdAt: "desc" }, take: 10 } },
      orderBy: { totalPoints: "desc" }
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error("List loyalty members error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router45.post("/", authMiddleware, validate(CreateLoyaltyMemberSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { name, phone, customerId, tier } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: "Name required" });
    const data = await prisma2.loyaltyMember.create({
      data: { name: name.trim(), phone: phone || null, customerId: customerId || null, tier: tier || "bronze" },
      include: { transactions: true }
    });
    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error("Create loyalty member error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router45.post("/:id/points", authMiddleware, validate(LoyaltyPointsSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const loyaltyId = String(req.params.id);
    const { action, amount, description } = req.body;
    if (!action || !amount) return res.status(400).json({ success: false, error: "Action and amount required" });
    const pts = Number(amount);
    await prisma2.loyaltyTransaction.create({
      data: { memberId: loyaltyId, action, amount: pts, description: description || null }
    });
    const updateData = {};
    if (action === "earn" || action === "bonus") {
      updateData.totalPoints = { increment: pts };
      updateData.lifetimePoints = { increment: pts };
    } else if (action === "redeem" || action === "expire") {
      updateData.totalPoints = { decrement: pts };
    }
    const member = await prisma2.loyaltyMember.update({
      where: { id: loyaltyId },
      data: updateData,
      include: { transactions: { orderBy: { createdAt: "desc" }, take: 10 } }
    });
    let newTier = "bronze";
    if (member.lifetimePoints >= 5e3) newTier = "diamond";
    else if (member.lifetimePoints >= 2e3) newTier = "gold";
    else if (member.lifetimePoints >= 500) newTier = "silver";
    if (newTier !== member.tier) {
      await prisma2.loyaltyMember.update({ where: { id: loyaltyId }, data: { tier: newTier } });
      member.tier = newTier;
    }
    res.json({ success: true, data: member });
  } catch (err) {
    console.error("Loyalty points error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router45.put("/:id", authMiddleware, validate(UpdateLoyaltyMemberSchema), async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const loyId = String(req.params.id);
    const { name, phone, tier, totalSpent } = req.body;
    const data = await prisma2.loyaltyMember.update({
      where: { id: loyId },
      data: {
        ...name !== void 0 && { name },
        ...phone !== void 0 && { phone },
        ...tier !== void 0 && { tier },
        ...totalSpent !== void 0 && { totalSpent }
      },
      include: { transactions: { orderBy: { createdAt: "desc" }, take: 10 } }
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error("Update loyalty member error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router45.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    await prisma2.loyaltyMember.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete loyalty member error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var loyalty_default = router45;

// src/routes/reviews.ts
var import_express46 = require("express");
var router46 = (0, import_express46.Router)();
router46.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { search, productId, sortBy } = req.query;
    const where = {};
    if (productId) where.productId = productId;
    if (search) {
      const q = String(search);
      where.OR = [{ productName: { contains: q } }, { customerName: { contains: q } }, { comment: { contains: q } }];
    }
    const data = await prisma2.review.findMany({
      where,
      orderBy: sortBy === "rating" ? { rating: "desc" } : { createdAt: "desc" }
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error("List reviews error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router46.get("/analytics", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const reviews = await prisma2.review.findMany({ where: {} });
    const productMap = /* @__PURE__ */ new Map();
    for (const r of reviews) {
      const key = r.productId || r.productName;
      if (!productMap.has(key)) {
        productMap.set(key, { productName: r.productName, category: r.category || "Kh\xE1c", reviews: [] });
      }
      productMap.get(key).reviews.push(r);
    }
    const analytics = Array.from(productMap.entries()).map(([id, g]) => {
      const totalReviews = g.reviews.length;
      const avgRating = g.reviews.reduce((s, r) => s + r.rating, 0) / totalReviews;
      const distribution = [0, 0, 0, 0, 0];
      const sentiment = { positive: 0, negative: 0, neutral: 0 };
      for (const r of g.reviews) {
        distribution[r.rating - 1]++;
        if (r.sentiment === "positive") sentiment.positive++;
        else if (r.sentiment === "negative") sentiment.negative++;
        else sentiment.neutral++;
      }
      return {
        id,
        productName: g.productName,
        category: g.category,
        totalReviews,
        avgRating: Math.round(avgRating * 10) / 10,
        distribution,
        sentiment: {
          positive: Math.round(sentiment.positive / totalReviews * 100),
          negative: Math.round(sentiment.negative / totalReviews * 100),
          neutral: Math.round(sentiment.neutral / totalReviews * 100)
        }
      };
    });
    res.json({ success: true, data: analytics });
  } catch (err) {
    console.error("Review analytics error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router46.post("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { productId, productName, category, customerName, rating, comment, sentiment } = req.body;
    if (!productName?.trim() || !rating) return res.status(400).json({ success: false, error: "Product name and rating required" });
    const data = await prisma2.review.create({
      data: {
        productId: productId || null,
        productName: productName.trim(),
        category: category || null,
        customerName: customerName || null,
        rating: Number(rating),
        comment: comment || null,
        sentiment: sentiment || (Number(rating) >= 4 ? "positive" : Number(rating) <= 2 ? "negative" : "neutral")
      }
    });
    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error("Create review error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router46.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    await prisma2.review.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete review error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var reviews_default = router46;

// src/routes/payroll.ts
var import_express47 = require("express");
var router47 = (0, import_express47.Router)();
router47.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { year, month } = req.query;
    const where = {};
    if (year) where.year = Number(year);
    if (month) where.month = Number(month);
    const records = await prisma2.payrollRecord.findMany({
      where,
      orderBy: [{ year: "desc" }, { month: "desc" }, { employeeName: "asc" }]
    });
    res.json({ success: true, data: records });
  } catch (err) {
    console.error("Get payroll error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router47.get("/history", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const records = await prisma2.payrollRecord.findMany({
      select: { year: true, month: true, status: true },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      distinct: ["year", "month"]
    });
    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router47.post("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { year, month, rows } = req.body;
    if (!year || !month || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, error: "year, month and rows required" });
    }
    const results = await Promise.all(
      rows.map(
        (row) => prisma2.payrollRecord.upsert({
          where: {
            employeeId_year_month: {
              employeeId: row.id,
              year: Number(year),
              month: Number(month)
            }
          },
          create: {
            year: Number(year),
            month: Number(month),
            employeeId: row.id,
            employeeName: row.name,
            employeeCode: row.code || null,
            department: row.department || null,
            grossSalary: row.grossSalary || 0,
            workdays: row.workdays || 26,
            actualDays: row.actualDays || 26,
            bonus: row.bonus || 0,
            actualGross: row.actualGross || 0,
            bhxh_emp: row.bhxh_emp || 0,
            bhyt_emp: row.bhyt_emp || 0,
            bhtn_emp: row.bhtn_emp || 0,
            bhxh_er: row.bhxh_er || 0,
            bhyt_er: row.bhyt_er || 0,
            bhtn_er: row.bhtn_er || 0,
            pit: row.pit || 0,
            netSalary: row.netSalary || 0,
            totalCost: row.totalCost || 0,
            dependents: row.dependents || 0,
            status: row.status || "draft"
          },
          update: {
            employeeName: row.name,
            employeeCode: row.code || null,
            department: row.department || null,
            grossSalary: row.grossSalary || 0,
            workdays: row.workdays || 26,
            actualDays: row.actualDays || 26,
            bonus: row.bonus || 0,
            actualGross: row.actualGross || 0,
            bhxh_emp: row.bhxh_emp || 0,
            bhyt_emp: row.bhyt_emp || 0,
            bhtn_emp: row.bhtn_emp || 0,
            bhxh_er: row.bhxh_er || 0,
            bhyt_er: row.bhyt_er || 0,
            bhtn_er: row.bhtn_er || 0,
            pit: row.pit || 0,
            netSalary: row.netSalary || 0,
            totalCost: row.totalCost || 0,
            dependents: row.dependents || 0,
            status: row.status || "draft"
          }
        })
      )
    );
    res.json({ success: true, data: results, count: results.length });
  } catch (err) {
    console.error("Save payroll error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router47.put("/:id/status", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { status } = req.body;
    if (!["draft", "pending", "paid"].includes(status)) {
      return res.status(400).json({ success: false, error: "Invalid status" });
    }
    const record = await prisma2.payrollRecord.update({
      where: { id: String(req.params.id) },
      data: {
        status,
        paidAt: status === "paid" ? /* @__PURE__ */ new Date() : null
      }
    });
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router47.put("/bulk-status", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { year, month, status } = req.body;
    if (!year || !month || !status) return res.status(400).json({ success: false, error: "year, month, status required" });
    const result = await prisma2.payrollRecord.updateMany({
      where: { year: Number(year), month: Number(month) },
      data: {
        status,
        paidAt: status === "paid" ? /* @__PURE__ */ new Date() : void 0
      }
    });
    res.json({ success: true, count: result.count });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var payroll_default = router47;

// src/routes/onlineOrders.ts
var import_express48 = require("express");

// src/services/platforms/base.ts
var import_crypto3 = __toESM(require("crypto"));
var PlatformService = class {
  constructor(credentials) {
    this.credentials = credentials;
  }
  // ─── Shared utilities ────────────────────────────────────────────────────────
  hmacSha256(data, secret) {
    return import_crypto3.default.createHmac("sha256", secret).update(data).digest("hex");
  }
  async httpGet(url, headers = {}) {
    const res = await fetch(url, { method: "GET", headers: { "Content-Type": "application/json", ...headers } });
    return res.json();
  }
  async httpPost(url, body, headers = {}) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body)
    });
    return res.json();
  }
};

// src/services/platforms/shopee.ts
var SHOPEE_HOST = "https://partner.shopeemobile.com";
var SHOPEE_API = `${SHOPEE_HOST}/api/v2`;
var ShopeeService = class extends PlatformService {
  get platformName() {
    return "shopee";
  }
  // ─── Auth ────────────────────────────────────────────────────────────────────
  sign(path, timestamp) {
    const { apiKey: partnerId, apiSecret } = this.credentials;
    const baseString = `${partnerId}${path}${timestamp}`;
    return this.hmacSha256(baseString, apiSecret);
  }
  signWithToken(path, timestamp) {
    const { apiKey: partnerId, apiSecret, accessToken, shopId } = this.credentials;
    const baseString = `${partnerId}${path}${timestamp}${accessToken}${shopId}`;
    return this.hmacSha256(baseString, apiSecret);
  }
  generateAuthUrl(redirectUri, state) {
    const timestamp = Math.floor(Date.now() / 1e3);
    const path = "/api/v2/shop/auth_partner";
    const sign = this.sign(path, timestamp);
    const params = new URLSearchParams({
      partner_id: this.credentials.apiKey,
      timestamp: String(timestamp),
      sign,
      redirect: redirectUri
    });
    return `${SHOPEE_HOST}${path}?${params}`;
  }
  async exchangeToken(code, redirectUri) {
    const timestamp = Math.floor(Date.now() / 1e3);
    const path = "/api/v2/auth/token/get";
    const sign = this.sign(path, timestamp);
    const url = `${SHOPEE_API}/auth/token/get?partner_id=${this.credentials.apiKey}&timestamp=${timestamp}&sign=${sign}`;
    const body = {
      code,
      shop_id: parseInt(this.credentials.shopId || "0"),
      partner_id: parseInt(this.credentials.apiKey)
    };
    const data = await this.httpPost(url, body);
    if (data.error) throw new Error(`Shopee auth error: ${data.error} - ${data.message}`);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expire_in,
      shopId: String(data.shop_id || this.credentials.shopId)
    };
  }
  async refreshAccessToken() {
    const timestamp = Math.floor(Date.now() / 1e3);
    const path = "/api/v2/auth/access_token/get";
    const sign = this.sign(path, timestamp);
    const url = `${SHOPEE_API}/auth/access_token/get?partner_id=${this.credentials.apiKey}&timestamp=${timestamp}&sign=${sign}`;
    const body = {
      refresh_token: this.credentials.refreshToken,
      shop_id: parseInt(this.credentials.shopId || "0"),
      partner_id: parseInt(this.credentials.apiKey)
    };
    const data = await this.httpPost(url, body);
    if (data.error) throw new Error(`Shopee refresh error: ${data.error} - ${data.message}`);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expire_in,
      shopId: String(data.shop_id)
    };
  }
  // ─── Orders ──────────────────────────────────────────────────────────────────
  apiUrl(path) {
    const timestamp = Math.floor(Date.now() / 1e3);
    const sign = this.signWithToken(path, timestamp);
    return `${SHOPEE_HOST}${path}?partner_id=${this.credentials.apiKey}&timestamp=${timestamp}&sign=${sign}&shop_id=${this.credentials.shopId}&access_token=${this.credentials.accessToken}`;
  }
  async fetchOrders(params) {
    const path = "/api/v2/order/get_order_list";
    const now = Math.floor(Date.now() / 1e3);
    const timeFrom = params.since ? Math.floor(params.since.getTime() / 1e3) : now - 7 * 86400;
    const cursor = ((params.page || 1) - 1) * (params.pageSize || 50);
    const url = this.apiUrl(path) + `&time_range_field=create_time&time_from=${timeFrom}&time_to=${now}&page_size=${params.pageSize || 50}&cursor=${cursor}&response_optional_fields=order_status`;
    const data = await this.httpGet(url);
    if (data.error) throw new Error(`Shopee getOrders: ${data.error} - ${data.message}`);
    const orderList = data.response?.order_list || [];
    const orders = [];
    if (orderList.length > 0) {
      const orderIds = orderList.map((o) => o.order_sn).join(",");
      const detailPath = "/api/v2/order/get_order_detail";
      const detailUrl = this.apiUrl(detailPath) + `&order_sn_list=${orderIds}&response_optional_fields=buyer_user_id,buyer_username,estimated_shipping_fee,recipient_address,actual_shipping_fee,item_list,pay_time,ship_by_date,total_amount,order_chargeable_weight`;
      const detailData = await this.httpGet(detailUrl);
      const details = detailData.response?.order_list || [];
      for (const d of details) {
        orders.push(this.mapOrder(d));
      }
    }
    return {
      orders,
      hasMore: data.response?.more || false,
      total: orders.length
    };
  }
  async getOrderDetail(externalOrderId) {
    const path = "/api/v2/order/get_order_detail";
    const url = this.apiUrl(path) + `&order_sn_list=${externalOrderId}&response_optional_fields=buyer_user_id,buyer_username,estimated_shipping_fee,recipient_address,actual_shipping_fee,item_list,pay_time,total_amount`;
    const data = await this.httpGet(url);
    const detail = data.response?.order_list?.[0];
    return detail ? this.mapOrder(detail) : null;
  }
  async testConnection() {
    try {
      const path = "/api/v2/shop/get_shop_info";
      const url = this.apiUrl(path);
      const data = await this.httpGet(url);
      if (data.error) return { success: false, error: `${data.error}: ${data.message}` };
      return { success: true, shopName: data.response?.shop_name || data.response?.shop_id };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  // ─── Mappers ─────────────────────────────────────────────────────────────────
  mapOrder(d) {
    const addr = d.recipient_address || {};
    const items = (d.item_list || []).map((item) => ({
      externalItemId: String(item.item_id),
      productName: item.item_name,
      sku: item.item_sku,
      quantity: item.model_quantity_purchased || 1,
      unitPrice: item.model_discounted_price || item.model_original_price || 0,
      discount: (item.model_original_price || 0) - (item.model_discounted_price || item.model_original_price || 0),
      lineTotal: (item.model_discounted_price || item.model_original_price || 0) * (item.model_quantity_purchased || 1)
    }));
    return {
      externalOrderId: d.order_sn,
      orderNumber: `SPE-${d.order_sn}`,
      platform: "shopee",
      status: this.mapStatus(d.order_status),
      externalStatus: d.order_status,
      customerName: addr.name || d.buyer_username || "Kh\xE1ch Shopee",
      customerPhone: addr.phone || "",
      shippingAddress: [addr.full_address, addr.district, addr.city, addr.state].filter(Boolean).join(", "),
      subtotal: items.reduce((s, i) => s + i.lineTotal, 0),
      discount: d.voucher_absorbed_by_seller || 0,
      shippingFee: d.actual_shipping_fee ?? d.estimated_shipping_fee ?? 0,
      total: d.total_amount || 0,
      paymentMethod: d.payment_method || "Shopee",
      paymentStatus: this.mapPaymentStatus(d.order_status),
      trackingNumber: d.tracking_no || void 0,
      shippingCarrier: d.shipping_carrier || void 0,
      items,
      createdAt: new Date((d.create_time || 0) * 1e3).toISOString(),
      paidAt: d.pay_time ? new Date(d.pay_time * 1e3).toISOString() : void 0,
      shippedAt: d.ship_by_date ? new Date(d.ship_by_date * 1e3).toISOString() : void 0
    };
  }
  mapStatus(s) {
    const MAP = {
      UNPAID: "pending",
      READY_TO_SHIP: "confirmed",
      PROCESSED: "processing",
      SHIPPED: "shipping",
      COMPLETED: "completed",
      IN_CANCEL: "cancelled",
      CANCELLED: "cancelled",
      INVOICE_PENDING: "pending"
    };
    return MAP[s] || "pending";
  }
  mapPaymentStatus(s) {
    if (s === "UNPAID" || s === "INVOICE_PENDING") return "unpaid";
    if (s === "CANCELLED" || s === "IN_CANCEL") return "refunded";
    return "paid";
  }
};

// src/services/platforms/lazada.ts
var LAZADA_AUTH = "https://auth.lazada.com";
var LAZADA_API = "https://api.lazada.vn/rest";
var LazadaService = class extends PlatformService {
  get platformName() {
    return "lazada";
  }
  // ─── Auth ────────────────────────────────────────────────────────────────────
  signRequest(apiPath, params) {
    const sorted = Object.keys(params).sort();
    const concat = apiPath + sorted.map((k) => `${k}${params[k]}`).join("");
    return this.hmacSha256(concat, this.credentials.apiSecret).toUpperCase();
  }
  buildUrl(apiPath, extraParams = {}) {
    const timestamp = Date.now();
    const params = {
      app_key: this.credentials.apiKey,
      timestamp: String(timestamp),
      sign_method: "sha256",
      access_token: this.credentials.accessToken || "",
      ...extraParams
    };
    const sign = this.signRequest(apiPath, params);
    params.sign = sign;
    const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    return `${LAZADA_API}${apiPath}?${qs}`;
  }
  generateAuthUrl(redirectUri, state) {
    const params = new URLSearchParams({
      response_type: "code",
      redirect_uri: redirectUri,
      client_id: this.credentials.apiKey,
      state
    });
    return `${LAZADA_AUTH}/oauth/authorize?${params}`;
  }
  async exchangeToken(code, redirectUri) {
    const apiPath = "/auth/token/create";
    const params = {
      app_key: this.credentials.apiKey,
      timestamp: String(Date.now()),
      sign_method: "sha256",
      code
    };
    const sign = this.signRequest(apiPath, params);
    params.sign = sign;
    const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    const url = `${LAZADA_API}${apiPath}?${qs}`;
    const data = await this.httpGet(url);
    if (data.code !== "0" && data.code !== 0) throw new Error(`Lazada auth error: ${data.message || data.code}`);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in || 604800,
      shopId: data.country_user_info?.[0]?.seller_id || void 0
    };
  }
  async refreshAccessToken() {
    const apiPath = "/auth/token/refresh";
    const params = {
      app_key: this.credentials.apiKey,
      timestamp: String(Date.now()),
      sign_method: "sha256",
      refresh_token: this.credentials.refreshToken || ""
    };
    const sign = this.signRequest(apiPath, params);
    params.sign = sign;
    const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    const url = `${LAZADA_API}${apiPath}?${qs}`;
    const data = await this.httpGet(url);
    if (data.code !== "0" && data.code !== 0) throw new Error(`Lazada refresh error: ${data.message}`);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in || 604800
    };
  }
  // ─── Orders ──────────────────────────────────────────────────────────────────
  async fetchOrders(params) {
    const offset = ((params.page || 1) - 1) * (params.pageSize || 50);
    const extraParams = {
      sort_direction: "DESC",
      sort_by: "updated_at",
      offset: String(offset),
      limit: String(Math.min(params.pageSize || 50, 100))
    };
    if (params.since) {
      extraParams.update_after = params.since.toISOString();
    }
    const url = this.buildUrl("/orders/get", extraParams);
    const data = await this.httpGet(url);
    if (data.code !== "0" && data.code !== 0) throw new Error(`Lazada getOrders: ${data.message}`);
    const orderList = data.data?.orders || [];
    const orders = [];
    for (const o of orderList) {
      const itemsUrl = this.buildUrl("/order/items/get", { order_id: String(o.order_id) });
      const itemsData = await this.httpGet(itemsUrl);
      const items = itemsData.data || [];
      orders.push(this.mapOrder(o, items));
    }
    return {
      orders,
      hasMore: orderList.length >= (params.pageSize || 50),
      total: data.data?.count || orders.length
    };
  }
  async getOrderDetail(externalOrderId) {
    const url = this.buildUrl("/order/get", { order_id: externalOrderId });
    const data = await this.httpGet(url);
    if (data.code !== "0" && data.code !== 0) return null;
    const itemsUrl = this.buildUrl("/order/items/get", { order_id: externalOrderId });
    const itemsData = await this.httpGet(itemsUrl);
    return this.mapOrder(data.data, itemsData.data || []);
  }
  async testConnection() {
    try {
      const url = this.buildUrl("/seller/get");
      const data = await this.httpGet(url);
      if (data.code !== "0" && data.code !== 0) return { success: false, error: data.message || "Unknown error" };
      return { success: true, shopName: data.data?.name || data.data?.company || "Lazada Shop" };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  // ─── Mappers ─────────────────────────────────────────────────────────────────
  mapOrder(o, rawItems) {
    const items = rawItems.map((item) => ({
      externalItemId: String(item.order_item_id || item.item_id),
      productName: item.name,
      sku: item.sku,
      quantity: 1,
      // Lazada: each item row = 1 qty
      unitPrice: parseFloat(item.item_price || "0"),
      discount: parseFloat(item.voucher_seller || "0"),
      lineTotal: parseFloat(item.paid_price || item.item_price || "0")
    }));
    const addr = o.address_shipping || {};
    return {
      externalOrderId: String(o.order_id),
      orderNumber: `LZD-${o.order_number || o.order_id}`,
      platform: "lazada",
      status: this.mapStatus(o.statuses?.[0] || o.status || ""),
      externalStatus: o.statuses?.[0] || o.status || "",
      customerName: `${addr.first_name || ""} ${addr.last_name || ""}`.trim() || o.customer_first_name || "Kh\xE1ch Lazada",
      customerPhone: addr.phone || o.customer_phone || "",
      shippingAddress: [addr.address1, addr.address2, addr.address3, addr.city, addr.country].filter(Boolean).join(", "),
      subtotal: parseFloat(o.price || "0"),
      discount: parseFloat(o.voucher_seller || "0"),
      shippingFee: parseFloat(o.shipping_fee || "0"),
      total: parseFloat(o.payment_amount || o.price || "0"),
      paymentMethod: o.payment_method || "Lazada",
      paymentStatus: this.mapPaymentStatus(o.statuses?.[0] || o.status || ""),
      trackingNumber: o.tracking_code || void 0,
      shippingCarrier: o.shipping_provider || void 0,
      items,
      createdAt: o.created_at || (/* @__PURE__ */ new Date()).toISOString(),
      paidAt: o.payment_time || void 0,
      shippedAt: o.shipped_at || void 0,
      deliveredAt: o.delivered_at || void 0
    };
  }
  mapStatus(s) {
    const MAP = {
      pending: "pending",
      unpaid: "pending",
      packed: "confirmed",
      ready_to_ship: "confirmed",
      ready_to_ship_pending: "confirmed",
      shipped: "shipping",
      delivered: "delivered",
      completed: "completed",
      returned: "returned",
      canceled: "cancelled",
      failed: "cancelled"
    };
    return MAP[s.toLowerCase()] || "pending";
  }
  mapPaymentStatus(s) {
    if (["unpaid", "pending"].includes(s.toLowerCase())) return "unpaid";
    if (["canceled", "failed", "returned"].includes(s.toLowerCase())) return "refunded";
    return "paid";
  }
};

// src/services/platforms/tiktok.ts
var TIKTOK_AUTH = "https://auth.tiktok-shops.com";
var TIKTOK_API = "https://open-api.tiktokglobalshop.com";
var TikTokService = class extends PlatformService {
  get platformName() {
    return "tiktok";
  }
  // ─── Auth ────────────────────────────────────────────────────────────────────
  signRequest(path, params, body) {
    const sorted = Object.keys(params).filter((k) => !["sign", "access_token", "app_secret"].includes(k)).sort();
    const paramString = sorted.map((k) => `${k}${params[k]}`).join("");
    const signBase = `${this.credentials.apiSecret}${path}${paramString}${body || ""}${this.credentials.apiSecret}`;
    return this.hmacSha256(signBase, this.credentials.apiSecret);
  }
  buildUrl(path, extraParams = {}, body) {
    const timestamp = Math.floor(Date.now() / 1e3);
    const params = {
      app_key: this.credentials.apiKey,
      timestamp: String(timestamp),
      shop_id: this.credentials.shopId || "",
      version: "202309",
      ...extraParams
    };
    const sign = this.signRequest(path, params, body);
    params.sign = sign;
    if (this.credentials.accessToken) params.access_token = this.credentials.accessToken;
    const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    return `${TIKTOK_API}${path}?${qs}`;
  }
  generateAuthUrl(redirectUri, state) {
    const params = new URLSearchParams({
      app_key: this.credentials.apiKey,
      state
    });
    return `${TIKTOK_AUTH}/oauth/authorize?${params}`;
  }
  async exchangeToken(code, redirectUri) {
    const url = `${TIKTOK_AUTH}/api/v2/token/get`;
    const body = {
      app_key: this.credentials.apiKey,
      app_secret: this.credentials.apiSecret,
      auth_code: code,
      grant_type: "authorized_code"
    };
    const data = await this.httpPost(url, body);
    if (data.code !== 0) throw new Error(`TikTok auth error: ${data.message || data.code}`);
    const tokenData = data.data || {};
    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.access_token_expire_in || 86400,
      shopId: tokenData.open_id || void 0
    };
  }
  async refreshAccessToken() {
    const url = `${TIKTOK_AUTH}/api/v2/token/refresh`;
    const body = {
      app_key: this.credentials.apiKey,
      app_secret: this.credentials.apiSecret,
      refresh_token: this.credentials.refreshToken,
      grant_type: "refresh_token"
    };
    const data = await this.httpPost(url, body);
    if (data.code !== 0) throw new Error(`TikTok refresh error: ${data.message}`);
    const tokenData = data.data || {};
    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.access_token_expire_in || 86400
    };
  }
  // ─── Orders ──────────────────────────────────────────────────────────────────
  async fetchOrders(params) {
    const path = "/order/202309/orders/search";
    const bodyObj = {
      page_size: Math.min(params.pageSize || 50, 100),
      sort_field: "CREATE_TIME",
      sort_order: "DESC"
    };
    if (params.since) {
      bodyObj.create_time_ge = Math.floor(params.since.getTime() / 1e3);
      bodyObj.create_time_lt = Math.floor(Date.now() / 1e3);
    }
    if (params.page && params.page > 1) {
      bodyObj.cursor = String((params.page - 1) * (params.pageSize || 50));
    }
    const bodyStr = JSON.stringify(bodyObj);
    const url = this.buildUrl(path, {}, bodyStr);
    const data = await this.httpPost(url, bodyObj);
    if (data.code !== 0) throw new Error(`TikTok getOrders: ${data.message}`);
    const orderList = data.data?.orders || [];
    const orders = orderList.map((o) => this.mapOrder(o));
    return {
      orders,
      hasMore: data.data?.next_page_token ? true : false,
      total: data.data?.total_count || orders.length
    };
  }
  async getOrderDetail(externalOrderId) {
    const path = `/order/202309/orders`;
    const url = this.buildUrl(path, { ids: externalOrderId });
    const data = await this.httpGet(url);
    if (data.code !== 0) return null;
    const order = data.data?.orders?.[0];
    return order ? this.mapOrder(order) : null;
  }
  async testConnection() {
    try {
      const path = "/authorization/202309/shops";
      const url = this.buildUrl(path);
      const data = await this.httpGet(url);
      if (data.code !== 0) return { success: false, error: data.message || "Unknown error" };
      const shop = data.data?.shops?.[0];
      return { success: true, shopName: shop?.shop_name || shop?.shop_id || "TikTok Shop" };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  // ─── Mappers ─────────────────────────────────────────────────────────────────
  mapOrder(o) {
    const addr = o.recipient_address || {};
    const items = (o.line_items || o.order_line_list || []).map((item) => ({
      externalItemId: item.id || item.order_line_id,
      productName: item.product_name || item.sku_name || "",
      sku: item.seller_sku || item.sku_id || "",
      quantity: item.quantity || 1,
      unitPrice: parseFloat(item.sale_price || item.original_price || "0") / 100,
      // TikTok uses cents
      discount: (parseFloat(item.platform_discount || "0") + parseFloat(item.seller_discount || "0")) / 100,
      lineTotal: parseFloat(item.sale_price || "0") * (item.quantity || 1) / 100
    }));
    const payment = o.payment || {};
    return {
      externalOrderId: o.id || o.order_id,
      orderNumber: `TIK-${o.id || o.order_id}`,
      platform: "tiktok",
      status: this.mapStatus(o.status?.toString() || ""),
      externalStatus: o.status?.toString() || "",
      customerName: addr.name || addr.full_name || "Kh\xE1ch TikTok",
      customerPhone: addr.phone_number || addr.phone || "",
      shippingAddress: [addr.address_detail, addr.district, addr.city, addr.region_code].filter(Boolean).join(", "),
      subtotal: items.reduce((s, i) => s + i.lineTotal, 0),
      discount: (parseFloat(payment.platform_discount || "0") + parseFloat(payment.seller_discount || "0")) / 100,
      shippingFee: parseFloat(payment.shipping_fee || o.shipping_fee || "0") / 100,
      total: parseFloat(payment.total_amount || o.payment_info?.total_amount || "0") / 100,
      paymentMethod: payment.payment_method || "TikTok",
      paymentStatus: this.mapPaymentStatus(o.status?.toString() || ""),
      trackingNumber: o.tracking_number || void 0,
      shippingCarrier: o.shipping_provider || o.shipping_provider_id || void 0,
      items,
      createdAt: o.create_time ? new Date(o.create_time * 1e3).toISOString() : (/* @__PURE__ */ new Date()).toISOString(),
      paidAt: o.paid_time ? new Date(o.paid_time * 1e3).toISOString() : void 0,
      shippedAt: o.rts_time ? new Date(o.rts_time * 1e3).toISOString() : void 0,
      deliveredAt: o.delivery_time ? new Date(o.delivery_time * 1e3).toISOString() : void 0
    };
  }
  mapStatus(s) {
    const MAP = {
      "100": "pending",
      UNPAID: "pending",
      "105": "pending",
      ON_HOLD: "pending",
      "111": "confirmed",
      AWAITING_SHIPMENT: "confirmed",
      "112": "confirmed",
      AWAITING_COLLECTION: "confirmed",
      "114": "processing",
      PARTIALLY_SHIPPING: "processing",
      "121": "shipping",
      IN_TRANSIT: "shipping",
      "122": "delivered",
      DELIVERED: "delivered",
      "130": "completed",
      COMPLETED: "completed",
      "140": "cancelled",
      CANCELLED: "cancelled"
    };
    return MAP[s] || "pending";
  }
  mapPaymentStatus(s) {
    if (["100", "UNPAID"].includes(s)) return "unpaid";
    if (["140", "CANCELLED"].includes(s)) return "refunded";
    return "paid";
  }
};

// src/services/platforms/index.ts
var SUPPORTED_PLATFORMS = ["shopee", "lazada", "tiktok"];
function isSupportedPlatform(platform) {
  return SUPPORTED_PLATFORMS.includes(platform);
}
function getPlatformService(platform, credentials) {
  switch (platform) {
    case "shopee":
      return new ShopeeService(credentials);
    case "lazada":
      return new LazadaService(credentials);
    case "tiktok":
      return new TikTokService(credentials);
    default:
      return null;
  }
}

// src/services/orderSync.ts
async function convertOnlineOrderToTransaction(prisma2, orderId) {
  const order = await prisma2.onlineOrder.findUnique({
    where: { id: orderId },
    include: { items: true }
  });
  if (!order) return false;
  const convertibleStatuses = ["confirmed", "processing", "shipping", "completed"];
  if (!convertibleStatuses.includes(order.status)) return false;
  const existing = await prisma2.transaction.findFirst({
    where: { receiptNumber: `ONLINE-${order.orderNumber}` }
  });
  if (existing) return false;
  const systemUser = await prisma2.user.findFirst({
    where: { role: { in: ["admin", "owner", "manager"] } },
    orderBy: { createdAt: "asc" }
  });
  if (!systemUser) {
    console.warn(`[OrderSync] No system user found, skipping order ${order.orderNumber}`);
    return false;
  }
  const transactionItems = [];
  const inventoryUpdates = [];
  for (const item of order.items) {
    let product = null;
    if (item.productId) {
      product = await prisma2.product.findUnique({ where: { id: item.productId } });
    }
    if (!product && item.sku) {
      product = await prisma2.product.findFirst({ where: { sku: item.sku } });
      if (product) {
        await prisma2.onlineOrderItem.update({
          where: { id: item.id },
          data: { productId: product.id }
        }).catch(() => {
        });
      }
    }
    if (product) {
      transactionItems.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount || 0,
        lineTotal: item.lineTotal
      });
      inventoryUpdates.push({
        productId: product.id,
        productName: product.name,
        productSku: product.sku,
        quantity: item.quantity
      });
    } else {
      console.log(`[OrderSync] SKU "${item.sku}" not found in inventory for order ${order.orderNumber}`);
    }
  }
  if (transactionItems.length === 0) {
    console.log(`[OrderSync] No matching products for order ${order.orderNumber}, skipping`);
    return false;
  }
  await prisma2.transaction.create({
    data: {
      receiptNumber: `ONLINE-${order.orderNumber}`,
      customerId: null,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      subtotal: order.subtotal,
      discount: order.discount,
      tax: 0,
      total: order.total,
      amountReceived: order.total,
      change: 0,
      status: "completed",
      createdBy: systemUser.id,
      createdByName: "H\u1EC7 th\u1ED1ng",
      notes: `\u0110\u01A1n online ${order.platform || "Shopee"} - ${order.orderNumber}`,
      transactionDate: order.createdAt,
      items: {
        create: transactionItems
      },
      payments: {
        create: [{
          type: order.paymentMethod || "online",
          amount: order.total,
          reference: order.externalOrderId || order.orderNumber
        }]
      }
    }
  });
  for (const inv of inventoryUpdates) {
    await prisma2.product.update({
      where: { id: inv.productId },
      data: { stock: { decrement: inv.quantity } }
    });
    await prisma2.inventoryTransaction.create({
      data: {
        type: "out",
        productId: inv.productId,
        productName: inv.productName,
        productSku: inv.productSku,
        quantity: -inv.quantity,
        reason: "B\xE1n h\xE0ng online",
        note: `\u0110\u01A1n ${order.orderNumber} (${order.platform || "Shopee"})`,
        referenceId: order.id,
        referenceType: "online_order",
        userId: systemUser.id,
        userName: "H\u1EC7 th\u1ED1ng",
        transactionDate: order.createdAt
      }
    });
  }
  console.log(`[OrderSync] Converted order ${order.orderNumber} \u2192 Transaction + ${inventoryUpdates.length} inventory updates`);
  return true;
}
async function processNewOrders(prisma2, channelId) {
  const orders = await prisma2.onlineOrder.findMany({
    where: {
      channelId,
      status: { in: ["confirmed", "processing", "shipping", "completed"] }
    },
    select: { id: true, orderNumber: true }
  });
  let converted = 0;
  for (const order of orders) {
    try {
      const success = await convertOnlineOrderToTransaction(prisma2, order.id);
      if (success) converted++;
    } catch (err) {
      console.error(`[OrderSync] Error converting order ${order.orderNumber}:`, err.message);
    }
  }
  return converted;
}

// src/routes/onlineOrders.ts
var router48 = (0, import_express48.Router)();
router48.get("/stats", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { channelId, startDate, endDate } = req.query;
    const where = {};
    if (channelId) where.channelId = channelId;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }
    const [totalOrders, totals, byStatus, byChannel] = await Promise.all([
      prisma2.onlineOrder.count({ where }),
      prisma2.onlineOrder.aggregate({
        where,
        _sum: { total: true, shippingFee: true, discount: true }
      }),
      prisma2.onlineOrder.groupBy({
        by: ["status"],
        where,
        _count: true,
        _sum: { total: true }
      }),
      prisma2.onlineOrder.groupBy({
        by: ["platform"],
        where,
        _count: true,
        _sum: { total: true }
      })
    ]);
    const completedCount = byStatus.find((s) => s.status === "completed")?._count ?? 0;
    res.json({
      success: true,
      data: {
        totalOrders,
        totalRevenue: totals._sum.total ?? 0,
        totalShippingFee: totals._sum.shippingFee ?? 0,
        totalDiscount: totals._sum.discount ?? 0,
        completionRate: totalOrders > 0 ? Math.round(completedCount / totalOrders * 100) : 0,
        pendingCount: byStatus.find((s) => s.status === "pending")?._count ?? 0,
        processingCount: (byStatus.find((s) => s.status === "confirmed")?._count ?? 0) + (byStatus.find((s) => s.status === "processing")?._count ?? 0),
        shippingCount: byStatus.find((s) => s.status === "shipping")?._count ?? 0,
        byStatus: byStatus.map((s) => ({ status: s.status, count: s._count, revenue: s._sum.total ?? 0 })),
        byChannel: byChannel.map((c) => ({ platform: c.platform, count: c._count, revenue: c._sum.total ?? 0 }))
      }
    });
  } catch (err) {
    console.error("Get online order stats error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router48.get("/channels", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const channels = await prisma2.onlineChannel.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { orders: true } } }
    });
    res.json({ success: true, data: channels });
  } catch (err) {
    console.error("Get channels error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router48.post("/channels", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { name, platform, shopUrl, apiKey, apiSecret, accessToken, syncEnabled } = req.body;
    if (!name || !platform) {
      res.status(400).json({ success: false, error: "T\xEAn v\xE0 n\u1EC1n t\u1EA3ng l\xE0 b\u1EAFt bu\u1ED9c" });
      return;
    }
    const channel = await prisma2.onlineChannel.create({
      data: { name, platform, shopUrl, apiKey, apiSecret, accessToken, syncEnabled: syncEnabled ?? false }
    });
    res.json({ success: true, data: channel });
  } catch (err) {
    console.error("Create channel error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router48.put("/channels/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { id } = req.params;
    const { name, platform, status, shopUrl, apiKey, apiSecret, accessToken, syncEnabled } = req.body;
    const data = {};
    if (name !== void 0) data.name = name;
    if (platform !== void 0) data.platform = platform;
    if (status !== void 0) data.status = status;
    if (shopUrl !== void 0) data.shopUrl = shopUrl;
    if (apiKey !== void 0) data.apiKey = apiKey;
    if (apiSecret !== void 0) data.apiSecret = apiSecret;
    if (accessToken !== void 0) data.accessToken = accessToken;
    if (syncEnabled !== void 0) data.syncEnabled = syncEnabled;
    const channel = await prisma2.onlineChannel.update({
      where: { id },
      data
    });
    res.json({ success: true, data: channel });
  } catch (err) {
    console.error("Update channel error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router48.delete("/channels/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { id } = req.params;
    const orderCount = await prisma2.onlineOrder.count({ where: { channelId: id } });
    if (orderCount > 0) {
      res.status(400).json({ success: false, error: `Kh\xF4ng th\u1EC3 x\xF3a k\xEAnh \u0111ang c\xF3 ${orderCount} \u0111\u01A1n h\xE0ng` });
      return;
    }
    await prisma2.onlineChannel.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete channel error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router48.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const {
      search,
      status,
      channelId,
      platform,
      paymentStatus,
      startDate,
      endDate,
      page = "1",
      pageSize = "20"
    } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
    const skip2 = (pageNum - 1) * size;
    const where = {};
    if (status && status !== "all") where.status = status;
    if (channelId) where.channelId = channelId;
    if (platform && platform !== "all") where.platform = platform;
    if (paymentStatus && paymentStatus !== "all") where.paymentStatus = paymentStatus;
    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: "insensitive" } },
        { customerName: { contains: search, mode: "insensitive" } },
        { customerPhone: { contains: search, mode: "insensitive" } },
        { trackingNumber: { contains: search, mode: "insensitive" } }
      ];
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }
    const [total, orders] = await Promise.all([
      prisma2.onlineOrder.count({ where }),
      prisma2.onlineOrder.findMany({
        where,
        include: { items: true, channel: true },
        orderBy: { createdAt: "desc" },
        skip: skip2,
        take: size
      })
    ]);
    res.json({
      success: true,
      data: {
        items: orders,
        total,
        page: pageNum,
        pageSize: size,
        totalPages: Math.ceil(total / size)
      }
    });
  } catch (err) {
    console.error("Get online orders error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router48.get("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const order = await prisma2.onlineOrder.findUnique({
      where: { id: req.params.id },
      include: { items: true, channel: true }
    });
    if (!order) {
      res.status(404).json({ success: false, error: "Kh\xF4ng t\xECm th\u1EA5y \u0111\u01A1n h\xE0ng" });
      return;
    }
    res.json({ success: true, data: order });
  } catch (err) {
    console.error("Get online order error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router48.post("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { items, ...orderData } = req.body;
    if (!orderData.customerName) {
      res.status(400).json({ success: false, error: "T\xEAn kh\xE1ch h\xE0ng l\xE0 b\u1EAFt bu\u1ED9c" });
      return;
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ success: false, error: "\u0110\u01A1n h\xE0ng c\u1EA7n \xEDt nh\u1EA5t 1 s\u1EA3n ph\u1EA9m" });
      return;
    }
    const today = /* @__PURE__ */ new Date();
    const prefix = `ON${today.getFullYear().toString().slice(-2)}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    const count = await prisma2.onlineOrder.count({
      where: { orderNumber: { startsWith: prefix } }
    });
    const orderNumber = `${prefix}-${String(count + 1).padStart(4, "0")}`;
    let channelName = orderData.channelName;
    let platform = orderData.platform;
    if (orderData.channelId && !channelName) {
      const channel = await prisma2.onlineChannel.findUnique({ where: { id: orderData.channelId } });
      if (channel) {
        channelName = channel.name;
        platform = platform || channel.platform;
      }
    }
    const order = await prisma2.onlineOrder.create({
      data: {
        orderNumber,
        channelId: orderData.channelId || void 0,
        channelName,
        platform,
        customerName: orderData.customerName,
        customerPhone: orderData.customerPhone || null,
        customerEmail: orderData.customerEmail || null,
        shippingAddress: orderData.shippingAddress || null,
        status: orderData.status || "pending",
        subtotal: orderData.subtotal || 0,
        discount: orderData.discount || 0,
        shippingFee: orderData.shippingFee || 0,
        total: orderData.total || 0,
        paymentMethod: orderData.paymentMethod || null,
        paymentStatus: orderData.paymentStatus || "unpaid",
        trackingNumber: orderData.trackingNumber || null,
        shippingCarrier: orderData.shippingCarrier || null,
        note: orderData.note || null,
        internalNote: orderData.internalNote || null,
        items: {
          create: items.map((item) => ({
            productId: item.productId || void 0,
            productName: item.productName,
            sku: item.sku || null,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount || 0,
            lineTotal: item.lineTotal || item.unitPrice * item.quantity - (item.discount || 0)
          }))
        }
      },
      include: { items: true, channel: true }
    });
    if (order.channelId) {
      await prisma2.onlineChannel.update({
        where: { id: order.channelId },
        data: {
          totalOrders: { increment: 1 },
          totalRevenue: { increment: order.total }
        }
      }).catch(() => {
      });
    }
    res.json({ success: true, data: order });
  } catch (err) {
    console.error("Create online order error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router48.put("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { id } = req.params;
    const { items, ...orderData } = req.body;
    const updateData = {};
    const fields = [
      "channelId",
      "channelName",
      "platform",
      "customerName",
      "customerPhone",
      "customerEmail",
      "shippingAddress",
      "subtotal",
      "discount",
      "shippingFee",
      "total",
      "paymentMethod",
      "paymentStatus",
      "trackingNumber",
      "shippingCarrier",
      "note",
      "internalNote"
    ];
    for (const f of fields) {
      if (orderData[f] !== void 0) updateData[f] = orderData[f];
    }
    if (orderData.paidAt) updateData.paidAt = new Date(orderData.paidAt);
    if (orderData.shippedAt) updateData.shippedAt = new Date(orderData.shippedAt);
    if (orderData.deliveredAt) updateData.deliveredAt = new Date(orderData.deliveredAt);
    const order = await prisma2.onlineOrder.update({
      where: { id },
      data: updateData,
      include: { items: true, channel: true }
    });
    res.json({ success: true, data: order });
  } catch (err) {
    console.error("Update online order error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router48.put("/:id/status", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { id } = req.params;
    const { status, trackingNumber, shippingCarrier } = req.body;
    const validStatuses = ["pending", "confirmed", "processing", "shipping", "delivered", "completed", "cancelled", "returned"];
    if (!status || !validStatuses.includes(status)) {
      res.status(400).json({ success: false, error: "Tr\u1EA1ng th\xE1i kh\xF4ng h\u1EE3p l\u1EC7" });
      return;
    }
    const updateData = { status };
    if (status === "shipping") {
      updateData.shippedAt = /* @__PURE__ */ new Date();
      if (trackingNumber) updateData.trackingNumber = trackingNumber;
      if (shippingCarrier) updateData.shippingCarrier = shippingCarrier;
    }
    if (status === "delivered") updateData.deliveredAt = /* @__PURE__ */ new Date();
    if (status === "completed") updateData.paymentStatus = "paid";
    if (status === "completed" && !updateData.paidAt) updateData.paidAt = /* @__PURE__ */ new Date();
    const order = await prisma2.onlineOrder.update({
      where: { id },
      data: updateData,
      include: { items: true, channel: true }
    });
    res.json({ success: true, data: order });
  } catch (err) {
    console.error("Update online order status error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router48.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { id } = req.params;
    const order = await prisma2.onlineOrder.findUnique({ where: { id } });
    if (!order) {
      res.status(404).json({ success: false, error: "Kh\xF4ng t\xECm th\u1EA5y \u0111\u01A1n h\xE0ng" });
      return;
    }
    if (!["pending", "cancelled"].includes(order.status)) {
      res.status(400).json({ success: false, error: "Ch\u1EC9 c\xF3 th\u1EC3 x\xF3a \u0111\u01A1n \u1EDF tr\u1EA1ng th\xE1i Ch\u1EDD x\u1EED l\xFD ho\u1EB7c \u0110\xE3 h\u1EE7y" });
      return;
    }
    await prisma2.onlineOrder.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete online order error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router48.post("/bulk-update", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { ids, status, trackingNumber, shippingCarrier } = req.body;
    if (!ids?.length || !status) {
      res.status(400).json({ success: false, error: "Thi\u1EBFu ids ho\u1EB7c status" });
      return;
    }
    const data = { status };
    if (trackingNumber) data.trackingNumber = trackingNumber;
    if (shippingCarrier) data.shippingCarrier = shippingCarrier;
    if (status === "shipping") data.shippedAt = /* @__PURE__ */ new Date();
    if (status === "delivered") data.deliveredAt = /* @__PURE__ */ new Date();
    if (status === "completed" || status === "delivered") data.paymentStatus = "paid";
    const result = await prisma2.onlineOrder.updateMany({
      where: { id: { in: ids } },
      data
    });
    res.json({ success: true, data: { updated: result.count } });
  } catch (err) {
    console.error("Bulk update error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router48.get("/channels/:id/auth-url", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const channel = await prisma2.onlineChannel.findUnique({ where: { id: req.params.id } });
    if (!channel) {
      res.status(404).json({ success: false, error: "K\xEAnh kh\xF4ng t\u1ED3n t\u1EA1i" });
      return;
    }
    if (!isSupportedPlatform(channel.platform)) {
      res.status(400).json({ success: false, error: `N\u1EC1n t\u1EA3ng "${channel.platform}" kh\xF4ng h\u1ED7 tr\u1EE3 k\u1EBFt n\u1ED1i API t\u1EF1 \u0111\u1ED9ng` });
      return;
    }
    const service = getPlatformService(channel.platform, {
      apiKey: channel.apiKey || "",
      apiSecret: channel.apiSecret || "",
      shopId: channel.shopId || void 0
    });
    if (!service) {
      res.status(400).json({ success: false, error: "N\u1EC1n t\u1EA3ng ch\u01B0a \u0111\u01B0\u1EE3c h\u1ED7 tr\u1EE3" });
      return;
    }
    const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const redirectUri = `${baseUrl}/api/online-orders/channels/${channel.id}/callback`;
    const state = Buffer.from(JSON.stringify({ channelId: channel.id })).toString("base64");
    const authUrl = service.generateAuthUrl(redirectUri, state);
    res.json({ success: true, data: { authUrl, redirectUri } });
  } catch (err) {
    console.error("Generate auth URL error:", err);
    res.status(500).json({ success: false, error: err.message || "Internal server error" });
  }
});
router48.get("/channels/:id/callback", async (req, res) => {
  try {
    const { code, shop_id } = req.query;
    if (!code) {
      res.status(400).send("Missing authorization code");
      return;
    }
    const channelId = req.params.id;
    const frontendUrl = process.env.FRONTEND_URL || "https://kengi.vn";
    const redirectUrl = `${frontendUrl}/dashboard-online-orders?oauth_code=${encodeURIComponent(code)}&channel_id=${encodeURIComponent(channelId)}${shop_id ? "&shop_id=" + encodeURIComponent(shop_id) : ""}`;
    res.redirect(redirectUrl);
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.status(500).send("L\u1ED7i k\u1EBFt n\u1ED1i: " + err.message);
  }
});
router48.post("/channels/:id/exchange-token", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const channel = await prisma2.onlineChannel.findUnique({ where: { id: req.params.id } });
    if (!channel) {
      res.status(404).json({ success: false, error: "K\xEAnh kh\xF4ng t\u1ED3n t\u1EA1i" });
      return;
    }
    const service = getPlatformService(channel.platform, {
      apiKey: channel.apiKey || "",
      apiSecret: channel.apiSecret || "",
      shopId: req.body.shopId || channel.shopId || void 0
    });
    if (!service) {
      res.status(400).json({ success: false, error: "N\u1EC1n t\u1EA3ng ch\u01B0a \u0111\u01B0\u1EE3c h\u1ED7 tr\u1EE3" });
      return;
    }
    const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const redirectUri = `${baseUrl}/api/online-orders/channels/${channel.id}/callback`;
    const tokens = await service.exchangeToken(req.body.code, redirectUri);
    await prisma2.onlineChannel.update({
      where: { id: channel.id },
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1e3),
        shopId: tokens.shopId || channel.shopId,
        syncEnabled: true
      }
    });
    await prisma2.syncLog.create({
      data: { channelId: channel.id, action: "exchange_token", status: "success", details: `Token obtained, shop: ${tokens.shopId || "N/A"}` }
    });
    res.json({ success: true, data: { shopId: tokens.shopId, expiresIn: tokens.expiresIn } });
  } catch (err) {
    console.error("Exchange token error:", err);
    res.status(500).json({ success: false, error: err.message || "Internal server error" });
  }
});
router48.post("/channels/:id/sync", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const channel = await prisma2.onlineChannel.findUnique({ where: { id: req.params.id } });
    if (!channel) {
      res.status(404).json({ success: false, error: "K\xEAnh kh\xF4ng t\u1ED3n t\u1EA1i" });
      return;
    }
    const service = getPlatformService(channel.platform, {
      apiKey: channel.apiKey || "",
      apiSecret: channel.apiSecret || "",
      accessToken: channel.accessToken || void 0,
      refreshToken: channel.refreshToken || void 0,
      shopId: channel.shopId || void 0
    });
    if (!service) {
      res.status(400).json({ success: false, error: "N\u1EC1n t\u1EA3ng ch\u01B0a \u0111\u01B0\u1EE3c h\u1ED7 tr\u1EE3" });
      return;
    }
    const since = channel.lastSyncAt || new Date(Date.now() - 7 * 864e5);
    let allOrders = [];
    let page = 1;
    let hasMore = true;
    while (hasMore && page <= 10) {
      const result = await service.fetchOrders({ since, page, pageSize: 50 });
      allOrders = allOrders.concat(result.orders);
      hasMore = result.hasMore;
      page++;
    }
    let imported = 0, updated = 0;
    const errors = [];
    for (const order of allOrders) {
      try {
        const existing = await prisma2.onlineOrder.findFirst({
          where: { externalOrderId: order.externalOrderId, channelId: channel.id }
        });
        if (existing) {
          await prisma2.onlineOrder.update({
            where: { id: existing.id },
            data: {
              status: order.status,
              externalStatus: order.externalStatus,
              paymentStatus: order.paymentStatus,
              trackingNumber: order.trackingNumber || existing.trackingNumber,
              shippingCarrier: order.shippingCarrier || existing.shippingCarrier,
              shippedAt: order.shippedAt ? new Date(order.shippedAt) : existing.shippedAt,
              deliveredAt: order.deliveredAt ? new Date(order.deliveredAt) : existing.deliveredAt,
              paidAt: order.paidAt ? new Date(order.paidAt) : existing.paidAt,
              syncedAt: /* @__PURE__ */ new Date()
            }
          });
          updated++;
        } else {
          await prisma2.onlineOrder.create({
            data: {
              orderNumber: order.orderNumber,
              channelId: channel.id,
              channelName: channel.name,
              platform: order.platform,
              externalOrderId: order.externalOrderId,
              externalStatus: order.externalStatus,
              customerName: order.customerName,
              customerPhone: order.customerPhone || null,
              customerEmail: order.customerEmail || null,
              shippingAddress: order.shippingAddress || null,
              status: order.status,
              subtotal: order.subtotal,
              discount: order.discount,
              shippingFee: order.shippingFee,
              total: order.total,
              paymentMethod: order.paymentMethod || null,
              paymentStatus: order.paymentStatus,
              trackingNumber: order.trackingNumber || null,
              shippingCarrier: order.shippingCarrier || null,
              paidAt: order.paidAt ? new Date(order.paidAt) : null,
              shippedAt: order.shippedAt ? new Date(order.shippedAt) : null,
              deliveredAt: order.deliveredAt ? new Date(order.deliveredAt) : null,
              syncedAt: /* @__PURE__ */ new Date(),
              createdAt: new Date(order.createdAt),
              platformFeeRate: channel.commissionRate || 0,
              platformFee: Math.round(order.total * (channel.commissionRate || 0) / 100),
              netRevenue: Math.round(order.total - order.total * (channel.commissionRate || 0) / 100 - order.shippingFee),
              items: {
                create: order.items.map((item) => ({
                  productName: item.productName,
                  sku: item.sku || null,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  discount: item.discount,
                  lineTotal: item.lineTotal
                }))
              }
            }
          });
          imported++;
        }
      } catch (e) {
        errors.push(`Order ${order.orderNumber}: ${e.message}`);
      }
    }
    const orderStats = await prisma2.onlineOrder.aggregate({
      where: { channelId: channel.id },
      _count: true,
      _sum: { total: true }
    });
    await prisma2.onlineChannel.update({
      where: { id: channel.id },
      data: {
        lastSyncAt: /* @__PURE__ */ new Date(),
        totalOrders: orderStats._count,
        totalRevenue: orderStats._sum.total || 0
      }
    });
    await prisma2.syncLog.create({
      data: {
        channelId: channel.id,
        action: "sync_orders",
        status: errors.length > 0 ? "partial" : "success",
        details: `Imported: ${imported}, Updated: ${updated}, Errors: ${errors.length}${errors.length > 0 ? "\n" + errors.slice(0, 5).join("\n") : ""}`,
        ordersCount: imported + updated
      }
    });
    let converted = 0;
    try {
      converted = await processNewOrders(prisma2, channel.id);
    } catch (e) {
      console.error("Order conversion error:", e.message);
    }
    res.json({
      success: true,
      data: { imported, updated, errors: errors.length, total: allOrders.length, converted }
    });
  } catch (err) {
    console.error("Sync orders error:", err);
    try {
      const prisma2 = req.storePrisma;
      await prisma2.syncLog.create({
        data: {
          channelId: req.params.id,
          action: "sync_orders",
          status: "error",
          details: err.message
        }
      });
    } catch (_) {
    }
    res.status(500).json({ success: false, error: err.message || "Internal server error" });
  }
});
router48.get("/channels/:id/sync-logs", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const logs = await prisma2.syncLog.findMany({
      where: { channelId: req.params.id },
      orderBy: { createdAt: "desc" },
      take: 20
    });
    res.json({ success: true, data: logs });
  } catch (err) {
    console.error("Get sync logs error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router48.post("/channels/:id/test-connection", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const channel = await prisma2.onlineChannel.findUnique({ where: { id: req.params.id } });
    if (!channel) {
      res.status(404).json({ success: false, error: "K\xEAnh kh\xF4ng t\u1ED3n t\u1EA1i" });
      return;
    }
    const service = getPlatformService(channel.platform, {
      apiKey: channel.apiKey || "",
      apiSecret: channel.apiSecret || "",
      accessToken: channel.accessToken || void 0,
      refreshToken: channel.refreshToken || void 0,
      shopId: channel.shopId || void 0
    });
    if (!service) {
      res.json({ success: true, data: { connected: false, message: `N\u1EC1n t\u1EA3ng "${channel.platform}" ch\u01B0a h\u1ED7 tr\u1EE3 k\u1EBFt n\u1ED1i API` } });
      return;
    }
    const result = await service.testConnection();
    await prisma2.syncLog.create({
      data: {
        channelId: channel.id,
        action: "test_connection",
        status: result.success ? "success" : "error",
        details: result.success ? `Connected: ${result.shopName}` : `Error: ${result.error}`
      }
    });
    res.json({ success: true, data: { connected: result.success, shopName: result.shopName, error: result.error } });
  } catch (err) {
    console.error("Test connection error:", err);
    res.status(500).json({ success: false, error: err.message || "Internal server error" });
  }
});
router48.put("/channels/:id/fee-config", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { commissionRate } = req.body;
    if (commissionRate == null || commissionRate < 0 || commissionRate > 100) {
      res.status(400).json({ success: false, error: "commissionRate ph\u1EA3i t\u1EEB 0 \u0111\u1EBFn 100" });
      return;
    }
    const channel = await prisma2.onlineChannel.update({
      where: { id: req.params.id },
      data: { commissionRate: parseFloat(commissionRate) }
    });
    res.json({ success: true, data: channel });
  } catch (err) {
    console.error("Fee config error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var onlineOrders_default = router48;

// src/routes/upgradeRequests.ts
var import_express49 = require("express");
var router49 = (0, import_express49.Router)();
router49.post("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const { requestedPlan, addOns, extraBranches, monthlyTotal } = req.body;
    if (!requestedPlan || !["retail", "wholesale", "full"].includes(requestedPlan)) {
      return res.status(400).json({ success: false, error: "G\xF3i kh\xF4ng h\u1EE3p l\u1EC7 (retail/wholesale/full)" });
    }
    const storeCode = req.user?.storeCode;
    if (!storeCode) return res.status(400).json({ success: false, error: "Missing store code" });
    const store = await registryPrisma.store.findUnique({ where: { code: storeCode } });
    if (!store) return res.status(404).json({ success: false, error: "Store not found in registry" });
    const existingPending = await prisma2.$queryRawUnsafe(`
            SELECT id FROM "UpgradeRequest" WHERE status = 'pending' LIMIT 1
        `).catch(() => []);
    if (existingPending?.length > 0) {
      return res.status(409).json({ success: false, error: "\u0110\xE3 c\xF3 y\xEAu c\u1EA7u n\xE2ng c\u1EA5p \u0111ang ch\u1EDD duy\u1EC7t" });
    }
    const user = await prisma2.user.findUnique({ where: { id: req.user.userId }, select: { name: true } });
    await prisma2.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "UpgradeRequest" (
                "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
                "storeCode" TEXT NOT NULL,
                "storeName" TEXT NOT NULL DEFAULT '',
                "requestedBy" TEXT NOT NULL DEFAULT '',
                "requestedByName" TEXT NOT NULL DEFAULT '',
                "currentPlan" TEXT NOT NULL DEFAULT 'full',
                "requestedPlan" TEXT NOT NULL,
                "addOns" TEXT NOT NULL DEFAULT '[]',
                "extraBranches" INTEGER NOT NULL DEFAULT 0,
                "monthlyTotal" INTEGER NOT NULL DEFAULT 0,
                "status" TEXT NOT NULL DEFAULT 'pending',
                "rejectedReason" TEXT,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "UpgradeRequest_pkey" PRIMARY KEY ("id")
            )
        `);
    const id = `upg-${Date.now()}`;
    await prisma2.$executeRawUnsafe(
      `
            INSERT INTO "UpgradeRequest" ("id", "storeCode", "storeName", "requestedBy", "requestedByName", "currentPlan", "requestedPlan", "addOns", "extraBranches", "monthlyTotal", "status")
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
        `,
      id,
      storeCode,
      store.name || "",
      req.user.userId,
      user?.name || "",
      store.plan || "full",
      requestedPlan,
      JSON.stringify(addOns || []),
      extraBranches || 0,
      monthlyTotal || 0
    );
    res.status(201).json({
      success: true,
      data: { id, status: "pending" },
      message: "Y\xEAu c\u1EA7u n\xE2ng c\u1EA5p \u0111\xE3 \u0111\u01B0\u1EE3c g\u1EEDi, vui l\xF2ng ch\u1EDD superadmin duy\u1EC7t"
    });
  } catch (err) {
    console.error("Create upgrade request error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router49.get("/", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    await prisma2.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "UpgradeRequest" (
                "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
                "storeCode" TEXT NOT NULL,
                "storeName" TEXT NOT NULL DEFAULT '',
                "requestedBy" TEXT NOT NULL DEFAULT '',
                "requestedByName" TEXT NOT NULL DEFAULT '',
                "currentPlan" TEXT NOT NULL DEFAULT 'full',
                "requestedPlan" TEXT NOT NULL,
                "addOns" TEXT NOT NULL DEFAULT '[]',
                "extraBranches" INTEGER NOT NULL DEFAULT 0,
                "monthlyTotal" INTEGER NOT NULL DEFAULT 0,
                "status" TEXT NOT NULL DEFAULT 'pending',
                "rejectedReason" TEXT,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "UpgradeRequest_pkey" PRIMARY KEY ("id")
            )
        `).catch(() => {
    });
    const requests = await prisma2.$queryRawUnsafe(`
            SELECT * FROM "UpgradeRequest" ORDER BY "createdAt" DESC
        `).catch(() => []);
    res.json({ success: true, data: requests || [] });
  } catch (err) {
    console.error("List upgrade requests error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
router49.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const prisma2 = req.storePrisma;
    const id = req.params.id;
    await prisma2.$executeRawUnsafe(`
            DELETE FROM "UpgradeRequest" WHERE "id" = $1 AND "status" = 'pending'
        `, id);
    res.json({ success: true, message: "\u0110\xE3 h\u1EE7y y\xEAu c\u1EA7u n\xE2ng c\u1EA5p" });
  } catch (err) {
    console.error("Cancel upgrade request error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
var upgradeRequests_default = router49;

// src/cron/autoSync.ts
var SYNC_INTERVAL = 10 * 60 * 1e3;
var syncTimer = null;
async function syncChannel(storePrisma, channel) {
  const service = getPlatformService(channel.platform, {
    apiKey: channel.apiKey || "",
    apiSecret: channel.apiSecret || "",
    accessToken: channel.accessToken || void 0,
    refreshToken: channel.refreshToken || void 0,
    shopId: channel.shopId || void 0
  });
  if (!service) return { imported: 0, updated: 0, errors: ["Platform not supported"] };
  const since = channel.lastSyncAt || new Date(Date.now() - 7 * 864e5);
  let allOrders = [];
  let page = 1;
  let hasMore = true;
  while (hasMore && page <= 10) {
    const result = await service.fetchOrders({ since, page, pageSize: 50 });
    allOrders = allOrders.concat(result.orders);
    hasMore = result.hasMore;
    page++;
  }
  let imported = 0, updated = 0;
  const errors = [];
  for (const order of allOrders) {
    try {
      const existing = await storePrisma.onlineOrder.findFirst({
        where: { externalOrderId: order.externalOrderId, channelId: channel.id }
      });
      if (existing) {
        await storePrisma.onlineOrder.update({
          where: { id: existing.id },
          data: {
            status: order.status,
            externalStatus: order.externalStatus,
            paymentStatus: order.paymentStatus,
            trackingNumber: order.trackingNumber || existing.trackingNumber,
            shippingCarrier: order.shippingCarrier || existing.shippingCarrier,
            shippedAt: order.shippedAt ? new Date(order.shippedAt) : existing.shippedAt,
            deliveredAt: order.deliveredAt ? new Date(order.deliveredAt) : existing.deliveredAt,
            paidAt: order.paidAt ? new Date(order.paidAt) : existing.paidAt,
            syncedAt: /* @__PURE__ */ new Date()
          }
        });
        updated++;
      } else {
        await storePrisma.onlineOrder.create({
          data: {
            orderNumber: order.orderNumber,
            channelId: channel.id,
            channelName: channel.name,
            platform: order.platform,
            externalOrderId: order.externalOrderId,
            externalStatus: order.externalStatus,
            customerName: order.customerName,
            customerPhone: order.customerPhone || null,
            customerEmail: order.customerEmail || null,
            shippingAddress: order.shippingAddress || null,
            status: order.status,
            subtotal: order.subtotal,
            discount: order.discount,
            shippingFee: order.shippingFee,
            total: order.total,
            paymentMethod: order.paymentMethod || null,
            paymentStatus: order.paymentStatus,
            trackingNumber: order.trackingNumber || null,
            shippingCarrier: order.shippingCarrier || null,
            paidAt: order.paidAt ? new Date(order.paidAt) : null,
            shippedAt: order.shippedAt ? new Date(order.shippedAt) : null,
            deliveredAt: order.deliveredAt ? new Date(order.deliveredAt) : null,
            syncedAt: /* @__PURE__ */ new Date(),
            createdAt: new Date(order.createdAt),
            items: {
              create: order.items.map((item) => ({
                productName: item.productName,
                sku: item.sku || null,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                discount: item.discount,
                lineTotal: item.lineTotal
              }))
            }
          }
        });
        imported++;
      }
    } catch (e) {
      errors.push(`Order ${order.orderNumber}: ${e.message}`);
    }
  }
  const orderStats = await storePrisma.onlineOrder.aggregate({
    where: { channelId: channel.id },
    _count: true,
    _sum: { total: true }
  });
  await storePrisma.onlineChannel.update({
    where: { id: channel.id },
    data: {
      lastSyncAt: /* @__PURE__ */ new Date(),
      totalOrders: orderStats._count,
      totalRevenue: orderStats._sum.total || 0
    }
  });
  await storePrisma.syncLog.create({
    data: {
      channelId: channel.id,
      action: "auto_sync",
      status: errors.length > 0 ? "partial" : "success",
      details: `Auto-sync: Imported ${imported}, Updated ${updated}, Errors ${errors.length}`,
      ordersCount: imported + updated
    }
  });
  return { imported, updated, errors };
}
async function runAutoSync() {
  try {
    const stores = await registryPrisma.store.findMany({ where: { status: "active" } });
    let totalSynced = 0;
    for (const store of stores) {
      try {
        const storePrisma = getStorePrisma(store.schemaName);
        const channels = await storePrisma.onlineChannel.findMany({
          where: {
            status: "active",
            accessToken: { not: null }
          }
        });
        for (const channel of channels) {
          try {
            const result = await syncChannel(storePrisma, channel);
            if (result.imported > 0 || result.updated > 0) {
              console.log(`[AutoSync] ${store.name}/${channel.name}: +${result.imported} new, ${result.updated} updated`);
              totalSynced += result.imported + result.updated;
            }
            const converted = await processNewOrders(storePrisma, channel.id);
            if (converted > 0) {
              console.log(`[AutoSync] ${store.name}/${channel.name}: ${converted} orders \u2192 transactions`);
            }
          } catch (err) {
            console.error(`[AutoSync] Error syncing ${store.name}/${channel.name}:`, err.message);
          }
        }
      } catch (err) {
        if (!err.message?.includes("does not exist")) {
          console.error(`[AutoSync] Error processing store ${store.name}:`, err.message);
        }
      }
    }
    if (totalSynced > 0) {
      console.log(`[AutoSync] Completed: ${totalSynced} orders synced across ${stores.length} stores`);
    }
  } catch (err) {
    console.error("[AutoSync] Fatal error:", err.message);
  }
}
function startAutoSync() {
  if (syncTimer) return;
  console.log(`\u23F0 Auto-sync started (every ${SYNC_INTERVAL / 6e4} minutes)`);
  setTimeout(() => {
    runAutoSync();
    syncTimer = setInterval(runAutoSync, SYNC_INTERVAL);
  }, 3e4);
}
function stopAutoSync() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
    console.log("\u23F0 Auto-sync stopped");
  }
}

// src/index.ts
var app = (0, import_express50.default)();
var PORT = process.env.PORT || 3001;
app.use((0, import_helmet.default)({
  crossOriginEmbedderPolicy: false,
  // allow embedding for dev
  contentSecurityPolicy: false
  // managed by Next.js
}));
var allowedOrigins = [
  process.env.FRONTEND_URL || "https://kengi.vn",
  "https://kengi.vn",
  "https://www.kengi.vn",
  "https://open-retail.tinohosting.vn",
  "http://localhost:3000",
  "http://localhost:3001"
];
app.use((0, import_cors.default)({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    }
  },
  credentials: true
}));
app.use(import_express50.default.json({ limit: "10mb" }));
var authLimiter = (0, import_express_rate_limit.default)({
  windowMs: 15 * 60 * 1e3,
  // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Qu\xE1 nhi\u1EC1u l\u1EA7n th\u1EED \u0111\u0103ng nh\u1EADp. Vui l\xF2ng th\u1EED l\u1EA1i sau 15 ph\xFAt." },
  skip: (req) => process.env.NODE_ENV === "development" && (req.ip === "::1" || req.ip === "127.0.0.1")
});
var apiLimiter = (0, import_express_rate_limit.default)({
  windowMs: 60 * 1e3,
  // 1 minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Qu\xE1 nhi\u1EC1u y\xEAu c\u1EA7u. Vui l\xF2ng th\u1EED l\u1EA1i sau." },
  skip: (req) => process.env.NODE_ENV === "development" && (req.ip === "::1" || req.ip === "127.0.0.1")
});
app.use("/api/auth/login", authLimiter);
app.use("/api", apiLimiter);
app.use((req, _res, next) => {
  console.log(`[${(/* @__PURE__ */ new Date()).toLocaleTimeString()}] ${req.method} ${req.path} \u2014 origin: ${req.headers.origin || "none"}`);
  next();
});
app.use("/api/auth", auth_default);
app.use("/api/api-keys", apiKeys_default);
app.use("/api/products", products_default);
app.use("/api/categories", categories_default);
app.use("/api/brands", brands_default);
app.use("/api/customers", customers_default);
app.use("/api/customer-groups", customerGroups_default);
app.use("/api/inventory", inventory_default);
app.use("/api/transactions", transactions_default);
app.use("/api/promotions", promotions_default);
app.use("/api/dashboard", dashboard_default);
app.use("/api/suppliers", suppliers_default);
app.use("/api/purchase-orders", purchaseOrders_default);
app.use("/api/expenses", expenses_default);
app.use("/api/employees", employees_default);
app.use("/api/sales-tracking", salesTracking_default);
app.use("/api/sales-orders", salesOrders_default);
app.use("/api/import-receipts", importReceipts_default);
app.use("/api/notifications", notifications_default);
app.use("/api/warranties", warranties_default);
app.use("/api/repairs", repairs_default);
app.use("/api/quotations", quotations_default);
app.use("/api/audit-logs", auditLogs_default);
app.use("/api/price-history", priceHistory_default);
app.use("/api/shipping", shipping_default);
app.use("/api/drivers", drivers_default);
app.use("/api/tax", tax_default);
app.use("/api/segments", segments_default);
app.use("/api/currencies", currencies_default);
app.use("/api/feedback", feedback_default);
app.use("/api/schedule", schedule_default);
app.use("/api/schedules", schedule_default);
app.use("/api/returns", returns_default);
app.use("/api/debts", debts_default);
app.use("/api/bundles", bundles_default);
app.use("/api/reports/financial", financialReports_default);
app.use("/api/store-settings", storeSettings_default);
app.use("/api/branches", branches_default);
app.use("/api/price-lists", priceLists_default);
app.use("/api/admin", admin_default);
app.use("/api/import-data", importData_default);
app.use("/api/uploads", uploads_default);
app.use("/api/internal", sync_default);
app.use("/api/announcements", announcements_default);
app.use("/api/attendance", attendance_default);
app.use("/api/loyalty", loyalty_default);
app.use("/api/reviews", reviews_default);
app.use("/api/payroll", payroll_default);
app.use("/api/online-orders", onlineOrders_default);
app.use("/api/upgrade-requests", upgradeRequests_default);
app.get("/api/health", async (_req, res) => {
  const cache = await cacheHealth();
  res.json({
    status: "ok",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    architecture: "multi-schema",
    cache
  });
});
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ success: false, error: "Internal server error", detail: err?.message || String(err) });
});
if (!process.env.PASSENGER_BASE_URI) {
  const startTime = Date.now();
  registryPrisma.$connect().then(() => console.log("\u2705 Registry DB connected")).catch((err) => console.error("\u26A0\uFE0F Registry DB connection failed:", err.message)).then(() => {
    app.listen(PORT, () => {
      const elapsed = Date.now() - startTime;
      console.log(`\u{1F680} KengiTech API running on http://localhost:${PORT} (startup: ${elapsed}ms)`);
      console.log(`\u{1F4CB} Health check: http://localhost:${PORT}/api/health`);
      console.log(`\u{1F3D7}\uFE0F Architecture: Multi-schema (per-store isolation)`);
      startAutoSync();
    });
  });
  const shutdown = async () => {
    console.log("\u{1F6D1} Shutting down gracefully...");
    await disconnectAll();
    await cacheDisconnect();
    stopAutoSync();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
var index_default = app;
/*! Bundled license information:

decimal.js/decimal.mjs:
  (*!
   *  decimal.js v10.5.0
   *  An arbitrary-precision Decimal type for JavaScript.
   *  https://github.com/MikeMcl/decimal.js
   *  Copyright (c) 2025 Michael Mclaughlin <M8ch88l@gmail.com>
   *  MIT Licence
   *)
*/
