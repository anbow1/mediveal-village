// three.js r186 puts `swizzle: 'rgba'` in every GPUTextureViewDescriptor. Some
// Chromium builds (seen in Chromium 140, and so in Android WebViews of that
// age) implement an older draft of texture-component swizzle and reject the
// string with a TypeError, so the first texture view throws and the game never
// finishes loading on WebGPU. 'rgba' is the identity swizzle: dropping it
// changes nothing, so retry without it instead of losing WebGPU.

interface ViewDescriptor {
  swizzle?: unknown;
  [key: string]: unknown;
}

let installed = false;

export function installWebGpuCompat(): void {
  if (installed) return;
  installed = true;
  const Texture = (globalThis as { GPUTexture?: { prototype: { createView: (d?: ViewDescriptor) => unknown } } }).GPUTexture;
  if (!Texture) return;
  const createView = Texture.prototype.createView;
  Texture.prototype.createView = function (this: unknown, descriptor?: ViewDescriptor): unknown {
    try {
      return createView.call(this, descriptor);
    } catch (err) {
      if (!descriptor || !('swizzle' in descriptor) || (descriptor.swizzle !== undefined && descriptor.swizzle !== 'rgba')) throw err;
      const rest: ViewDescriptor = { ...descriptor };
      delete rest.swizzle;
      return createView.call(this, rest);
    }
  };
}
