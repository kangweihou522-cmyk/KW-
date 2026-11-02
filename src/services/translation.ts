import { invoke } from '../platform/electron/core';
import type {
  OpenAICompatibleTranslateOptions,
  OpenAICompatibleTranslateTextOptions,
  TranslationBlockOutput,
} from "../types/reader";

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return fallback;
}

export async function translateBlocksOpenAICompatible(
  options: OpenAICompatibleTranslateOptions,
): Promise<TranslationBlockOutput[]> {
  try {
    return await invoke<TranslationBlockOutput[]>(
      "translate_blocks_openai_compatible",
      {
        options,
      },
    );
  } catch (error) {
    throw new Error(toErrorMessage(error, "调用 OpenAI 兼容翻译接口失败"));
  }
}

export async function translateTextOpenAICompatible(
  options: OpenAICompatibleTranslateTextOptions,
): Promise<string> {
  try {
    return await invoke<string>("translate_text_openai_compatible", {
      options,
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, "调用 OpenAI 兼容划词翻译接口失败"));
  }
}

export async function translateBlocksQuality(options: OpenAICompatibleTranslateOptions, documentId: string, pdfPath?: string | null): Promise<TranslationBlockOutput[]> {
  const result: TranslationBlockOutput[] = [];
  for (const block of options.blocks) {
    const value = await invoke<{ translation: string }>('quality_translate_block', { text: block.text, documentId, pdfPath, source: options.sourceLanguage, target: options.targetLanguage });
    result.push({ blockId: block.blockId, translatedText: value.translation });
  }
  return result;
}
