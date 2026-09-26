"use strict"

/** Dev-only: Next injects React Refresh calls into the PaddleOCR worker asset. */
module.exports = function stripRefreshForWorker(source) {
  if (typeof source !== "string" || !source.includes("$RefreshReg$")) return source
  return (
    "var $RefreshReg$=function(){};var $RefreshSig$=function(){return function(type){return type}};\n" +
    source
  )
}
