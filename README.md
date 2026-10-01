# OpenCode Go Live Catalog Extension v1.0.1

此 Pi extension 以帳號的 OpenCode Go `/v1/models` 為來源，在 Pi／Pi-Web 建立模型 runtime 時動態補上已驗證可用的新模型；它不修改 `auth.json` 或 `models.json`，也不會輸出 API Key。Pi 進行 provider refresh 時，成功結果會透過 provider catalog store 持久化至 `models-store.json`。

## 為什麼需要它

Pi 內建 `opencode-go` 是**靜態模型目錄**。Pi 會定期從 `pi.dev` 接收該目錄的 overlay，但 Pi 並不會以使用者的 OpenCode Go 訂閱憑證自動呼叫官方 `/v1/models`，因此上游先新增、Pi 目錄尚未更新時，模型不一定會出現。

這是 Pi 的目錄設計限制，不代表 OpenCode Go 訂閱或認證故障。

舊版 `Update-PiOpenCodeGoModels-v1.0.0.ps1` 只支援兩個硬編碼模板（`space-bunny-free`、`longcat-2.5-preview-free`），不能新增 `gpt-6-luna`；本 extension 用於取代該「新模型同步」用途。

## 已驗證自動同步範圍

目前安全地自動加入符合下列格式、且官方帳號目錄實際回傳的新 ID：

```text
^gpt-(版本)-luna$
```

例如：`gpt-6-luna`。

它以 Pi 內建且已驗證的 `gpt-5.6-luna` 為相容性模板，使用 `openai-responses` 與 Pi 原生 OpenCode session header 機制。2026-09-30 已對 `gpt-6-luna` 實測：

- `POST /zen/go/v1/responses` 的文字回應為 HTTP 200。
- Responses API function tool call 為 HTTP 200，並回傳 `function_call`。

其他未知模型不會由名稱猜測協定或能力而自動加入；OpenCode Go 的 `/v1/models` 只提供 ID，這能避免把 Chat Completions、Responses、Anthropic Messages 等協定誤配。

## 安裝狀態

檔案位於 Pi 使用者 extension 目錄：

```text
~/.pi/agent/extensions/opencode-go-live-catalog-v1.0.1/index.ts
```

Pi 會自動載入該目錄內的 `index.ts`。它僅使用 Pi 已提供的公開 extension API，不含額外 npm 相依套件；不需要重複執行舊 PowerShell 同步腳本。

## 使用方式

1. **重啟 Pi-Web**（修改 extension 後必須重啟），或重新啟動 Pi CLI。
2. 在 Pi-Web 重新載入模型頁面；Pi-Web 的模型 API 快取最長 60 秒。
3. 搜尋 `gpt-6-luna`。

Pi-Web 不會將 Pi extension 的自訂 slash command 顯示在 Web UI，因此不要在 Pi-Web 輸入 `/opencode-go-refresh`。模型 runtime 建立時會自動同步；若官方端點暫時無法連線，則保留內建模型清單。

## 資料與安全邊界

| 項目 | 行為 |
| --- | --- |
| 模型來源 | `https://opencode.ai/zen/go/v1/models` |
| 認證 | 啟動時僅讀取 Pi 現有 `auth.json` 的 `opencode-go.key`；不寫入、不記錄金鑰 |
| 持久化 | Pi provider refresh 時經 catalog store 寫入 `models-store.json`，只保存動態補丁 |
| `models.json` | 不寫入；既有 `space-bunny-free` 與 `longcat-2.5-preview-free` 定義仍保留且優先套用 |
| 未知模型 | 不自動加入，必須先驗證 API、輸入、工具、thinking 與 context 限制 |

## 版本相容性

開發與驗證版本：Pi 0.87.0、Pi-Web 內嵌 Pi 0.87.1。Extension 使用公開的 `@earendil-works/pi-ai/providers/all` 匯出；Pi 大版本更新後，請重新啟動 Pi-Web 並確認 `gpt-6-luna` 可見及可完成一般對話。

---

# English

## What it does

This Pi extension queries the authenticated OpenCode Go `/v1/models` endpoint whenever Pi or Pi-Web creates a model runtime. It safely adds verified live GPT-Luna models, such as `gpt-6-luna`, without modifying `auth.json` or `models.json` and without logging credentials.

Pi's built-in `opencode-go` catalog is static and may receive delayed updates through `pi.dev`. It does not normally query the model list attached to an individual OpenCode Go subscription, so a newly available upstream model may not appear immediately.

## Verified dynamic-model policy

Only live IDs matching the following pattern are added automatically:

```text
^gpt-(version)-luna$
```

The extension uses the built-in, verified `gpt-5.6-luna` profile as the compatibility template for a newer GPT-Luna model. `gpt-6-luna` has been verified with the OpenCode Go Responses API for both text responses and function tool calls.

Other unknown IDs are deliberately not inferred from their names. The OpenCode Go catalog returns model IDs only, which is insufficient to safely choose among Chat Completions, Responses, and Anthropic Messages APIs or to claim input, tool, thinking, and context capabilities.

## Installation and use

Place this repository in Pi's user extension directory, for example:

```text
~/.pi/agent/extensions/opencode-go-live-catalog-v1.0.1/
```

Pi discovers `index.ts` automatically. Restart Pi-Web or Pi after installation, then refresh the model page and search for `gpt-6-luna`. Pi-Web caches the model API response for up to 60 seconds.

Pi-Web does not expose custom Pi extension slash commands in its web UI. Synchronization occurs automatically during model-runtime creation; there is no slash command to run in Pi-Web.

## Security and persistence

| Item | Behavior |
| --- | --- |
| Model source | `https://opencode.ai/zen/go/v1/models` |
| Credentials | Reads the existing `opencode-go.key` from Pi's `auth.json`; never writes or logs it |
| Persistence | A Pi provider refresh may save only the dynamic model patch to `models-store.json` |
| `models.json` | Never modified; existing custom models remain in effect |
| Unknown models | Not added automatically until their protocol and capabilities are verified |

Tested with Pi 0.87.0 and Pi-Web's embedded Pi 0.87.1.
