import * as Cesium from 'cesium'
import {
  enhanceImageBitmap,
  isImageryAiEnabled,
  preferredImageryAiScaleForZoom,
  shouldEnhanceRasterZoom,
} from './imageryAi.js'

type CesiumImage = Awaited<ReturnType<NonNullable<Cesium.ImageryProvider['requestImage']>>>

async function toBitmap(image: CesiumImage) {
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) return image
  if (typeof createImageBitmap !== 'function') return null

  try {
    return await createImageBitmap(image as ImageBitmapSource)
  } catch {
    return null
  }
}

export function wrapCesiumImageryProvider<T extends Cesium.ImageryProvider>(
  provider: T,
  minimumLevel = 14,
): T {
  const original = provider.requestImage.bind(provider)
  const patchable = provider as T & {
    requestImage: Cesium.ImageryProvider['requestImage']
  }

  patchable.requestImage = (x, y, level, request) => {
    const result = original(x, y, level, request)
    if (!result || !isImageryAiEnabled() || !shouldEnhanceRasterZoom(level ?? 0) || (level ?? 0) < minimumLevel) {
      return result
    }

    return Promise.resolve(result).then(async image => {
      const bitmap = await toBitmap(image)
      if (!bitmap) return image

      const enhanced = await enhanceImageBitmap(bitmap, preferredImageryAiScaleForZoom(level ?? 0))
      if (!enhanced) {
        if (!(typeof ImageBitmap !== 'undefined' && bitmap instanceof ImageBitmap)) bitmap.close?.()
        return image
      }

      if (typeof ImageBitmap !== 'undefined' && bitmap instanceof ImageBitmap) bitmap.close()
      return enhanced as CesiumImage
    }).catch(() => image)
  }

  return provider
}

export function createAiCesiumImageryProvider(
  url: string,
  credit: string,
  maximumLevel = 19,
  minimumLevel = 14,
) {
  const provider = new Cesium.UrlTemplateImageryProvider({
    url,
    credit: new Cesium.Credit(credit, false),
    maximumLevel,
    enablePickFeatures: false,
  })
  return wrapCesiumImageryProvider(provider, minimumLevel)
}
