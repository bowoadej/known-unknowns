"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.known = known;
exports.unknown = unknown;
exports.defineSubject = defineSubject;
function known(value) {
    return { status: "known", value: value };
}
function unknown() {
    return { status: "unknown" };
}
function defineSubject(fields) {
    return fields;
}
