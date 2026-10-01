import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Api, Model, Provider, RefreshModelsContext } from "@earendil-works/pi-ai"
import { builtinProviders } from "@earendil-works/pi-ai/providers/all"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

// OpenCode Go 只提供 /v1/models 的 ID；不能從 ID 推測任意模型的協定與能力。
// 因此僅自動加入已由實測確認可沿用 Responses API 設定的 GPT-Luna 新版本。
const MODELS_URL = "https://opencode.ai/zen/go/v1/models"
const REQUEST_TIMEOUT_MS = 10_000
const GPT_LUNA_PATTERN = /^gpt-(\d+(?:\.\d+)?)-luna$/

type LiveModelsResponse = {
  data?: Array<{ id?: unknown }>
}

/** 僅保留結構完整且已支援的持久化動態模型，避免舊版快取污染目前清單。 */
function restoreModels(context: RefreshModelsContext, builtinIds: ReadonlySet<string>): Model<Api>[] {
  return (context.stored?.models ?? []).filter(
    (model): model is Model<Api> =>
      typeof model?.id === "string" &&
      !builtinIds.has(model.id) &&
      GPT_LUNA_PATTERN.test(model.id) &&
      model.api === "openai-responses",
  )
}

/** 以已測試的 GPT-Luna Responses 設定建立後續版本，並保留 Pi 的 session header 流程。 */
function createGptLunaModel(id: string, prototype: Model<Api>): Model<Api> {
  const version = id.match(GPT_LUNA_PATTERN)?.[1] ?? id
  return {
    ...prototype,
    id,
    name: `GPT ${version} Luna (OpenCode Go; live catalog)`,
  }
}

function mergeModels(builtin: readonly Model<Api>[], dynamic: readonly Model<Api>[]): Model<Api>[] {
  const merged = new Map(builtin.map((model) => [model.id, model]))
  for (const model of dynamic) merged.set(model.id, model)
  return [...merged.values()]
}

async function discoverLiveModels(
  apiKey: string,
  signal: AbortSignal,
  builtin: readonly Model<Api>[],
): Promise<Model<Api>[]> {
  const builtinIds = new Set(builtin.map((model) => model.id))
  const response = await fetch(MODELS_URL, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "User-Agent": "Pi-OpenCodeGo-LiveCatalog/1.0",
    },
    signal,
  })
  if (!response.ok) {
    throw new Error(`OpenCode Go models request failed: HTTP ${response.status}`)
  }

  const payload = (await response.json()) as LiveModelsResponse
  const liveIds = new Set(
    (payload.data ?? [])
      .map((entry) => (typeof entry.id === "string" ? entry.id : ""))
      .filter((id) => id.length > 0),
  )
  const prototype = builtin.find((model) => model.id === "gpt-5.6-luna")
  if (!prototype) {
    throw new Error("Built-in GPT-Luna reference model is unavailable; catalog update was not applied.")
  }

  const dynamic = [...liveIds]
    .filter((id) => !builtinIds.has(id) && GPT_LUNA_PATTERN.test(id))
    .sort((left, right) => left.localeCompare(right))
    .map((id) => createGptLunaModel(id, prototype))

  return dynamic
}

/** 在 Pi-Web 建立 model runtime 時同步讀取已儲存的 Pi 認證，讓 Web 模型 API 立刻可見新模型。 */
async function loadStartupModels(builtin: readonly Model<Api>[]): Promise<Model<Api>[]> {
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent")
  try {
    // auth.json 可能是 UTF-8 BOM；JSON.parse 需先移除 BOM。
    const authText = await readFile(join(agentDir, "auth.json"), "utf8")
    const auth = JSON.parse(authText.replace(/^\uFEFF/, "")) as {
      "opencode-go"?: { key?: unknown }
    }
    const key = auth["opencode-go"]?.key
    if (typeof key !== "string" || key.trim() === "") return []
    return await discoverLiveModels(key, AbortSignal.timeout(REQUEST_TIMEOUT_MS), builtin)
  } catch {
    // 網路或認證檔暫時不可用時，保持 Pi 內建清單；不得輸出認證資訊。
    return []
  }
}

export default async function (pi: ExtensionAPI) {
  // 使用 Pi 內建 OpenCode Go provider，保留官方認證、三種 API 與動態 session header 行為。
  const builtin = builtinProviders().find((provider) => provider.id === "opencode-go")
  if (!builtin) throw new Error("Pi built-in OpenCode Go provider is unavailable.")
  const builtinModels = builtin.getModels() as readonly Model<Api>[]
  let dynamicModels = await loadStartupModels(builtinModels)

  const provider: Provider = {
    ...builtin,
    getModels: () => mergeModels(builtinModels, dynamicModels),
    refreshModels: async (context) => {
      const builtinIds = new Set(builtinModels.map((model) => model.id))
      const restored = restoreModels(context, builtinIds)
      // Pi 啟動會先進行離線 refresh；若舊快取沒有動態模型，不能覆蓋剛完成的即時查詢結果。
      if (restored.length > 0) {
        await context.publish({ update: () => { dynamicModels = restored } })
      }

      if (!context.allowNetwork || context.signal.aborted) return
      const credential = context.credential
      if (credential?.type !== "api_key" || !credential.key) return
      const signal = AbortSignal.any([context.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      const dynamic = await discoverLiveModels(credential.key, signal, builtinModels)

      // 此 provider 專用資料只持久化動態補丁；不會寫入 models.json 或 auth.json。
      await context.publish({
        persist: { models: dynamic, checkedAt: Date.now() },
        update: () => { dynamicModels = dynamic },
      })
    },
  }

  pi.registerProvider(provider)

}
