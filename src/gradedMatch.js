"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.gradedMatch = gradedMatch;
var SYSTEM_PROMPT = "You are a matching assistant. You are given a \"subject\" (a set of\nfields, some marked \"known\" with a value, others explicitly marked \"unknown\" -\nunknown fields are intentionally unspecified, not zero or average) and a list\nof candidates to rank against that subject.\n\nYour job: rank the candidates from best to worst match, and explain your\nreasoning for each one.\n\nRules you must follow:\n\n1. Never silently assume a default value for a field marked \"unknown\" on the\n   subject. If a ranking depends on an unknown field, say so explicitly in\n   your reasoning and lower your confidence for that ranking accordingly.\n\n2. Distinguish between what you know (stated subject fields, stated\n   candidate data) and what you're inferring (e.g. reasoning from a category\n   name, a style descriptor, or an indirect reference point). Label\n   inferences as inferences in your reasoning text.\n\n3. If a candidate conflicts with an explicit avoid rule, flag that clearly\n   even if other data looks fine. Distinguish two kinds of conflict, and\n   treat their confidence differently:\n   a) A conflict confirmed by an actual stated measurement or fact can be\n      \"measurement\" evidenceType and High confidence.\n   b) A conflict inferred only from a descriptor, category name, or indirect\n      reference, with NO supporting hard data, should generally be\n      \"descriptor\" or \"inferred\" evidenceType and Medium confidence, not\n      High - unless the descriptor is unambiguous and leaves little room for\n      interpretation. Be consistent about this distinction across all\n      candidates in a single run - don't rate one descriptor-only conflict\n      High and another Medium without a stated reason for the difference.\n\n4. Give each candidate a confidence level (High, Medium, or Low) based on how\n   much real data supports the ranking, not on how good the match seems, AND\n   an evidenceType (\"measurement\", \"descriptor\", \"inferred\", or \"mixed\")\n   describing what kind of evidence the ranking rests on.\n\n5. Be concise. One short paragraph of reasoning per candidate, not an essay.\n\nReturn your answer as JSON matching this shape:\n{\n  \"rankings\": [\n    {\n      \"candidateId\": \"...\",\n      \"candidateTitle\": \"...\",\n      \"rank\": 1,\n      \"confidence\": \"High\" | \"Medium\" | \"Low\",\n      \"evidenceType\": \"measurement\" | \"descriptor\" | \"inferred\" | \"mixed\",\n      \"reasoning\": \"...\"\n    }\n  ]\n}\n\nReturn ONLY the JSON, no other text, no markdown code fences.";
function serializeSubject(subject) {
    var out = {};
    for (var _i = 0, _a = Object.entries(subject); _i < _a.length; _i++) {
        var _b = _a[_i], key = _b[0], field = _b[1];
        out[key] = field.status === "known" ? field.value : "unknown";
    }
    return out;
}
function buildUserPrompt(subject, candidates, avoidRules) {
    return "SUBJECT:\n".concat(JSON.stringify(serializeSubject(subject), null, 2), "\n\nAVOID RULES:\n").concat(JSON.stringify(avoidRules, null, 2), "\n\nCANDIDATES:\n").concat(JSON.stringify(candidates, null, 2), "\n\nRank these candidates against the subject and explain your reasoning,\nfollowing the rules in your instructions.");
}
function gradedMatch(options) {
    return __awaiter(this, void 0, void 0, function () {
        var subject, candidates, _a, avoidRules, llm, userPrompt, rawResponse, cleaned, parsed;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    subject = options.subject, candidates = options.candidates, _a = options.avoidRules, avoidRules = _a === void 0 ? [] : _a, llm = options.llm;
                    userPrompt = buildUserPrompt(subject, candidates, avoidRules);
                    return [4 /*yield*/, llm.complete(SYSTEM_PROMPT, userPrompt)];
                case 1:
                    rawResponse = _b.sent();
                    cleaned = rawResponse.trim();
                    if (cleaned.startsWith("```")) {
                        cleaned = cleaned.replace(/^```(json)?/, "").replace(/```$/, "").trim();
                    }
                    try {
                        parsed = JSON.parse(cleaned);
                    }
                    catch (err) {
                        throw new Error("known-unknowns: LLM response was not valid JSON.\nRaw response:\n".concat(rawResponse));
                    }
                    parsed.rankings.sort(function (a, b) { return a.rank - b.rank; });
                    return [2 /*return*/, parsed];
            }
        });
    });
}
