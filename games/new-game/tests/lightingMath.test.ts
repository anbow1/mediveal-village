import { describe, expect, it } from 'vitest';
import { CALIBRATION, LIGHTING_PRESETS } from '../src/config.ts';
import {
  ev100FromLux,
  expectedExposedLambertian,
  exposureFromEv100,
  kelvinToLinearRgb,
  linearToSrgb,
  presetAnchorEv100,
  srgbToLinear,
  sunDirectionFromAngles,
} from '../src/sim/lightingMath.ts';

describe('lightingMath (NUMBERS.md physical calibration)', () => {
  it('computes EV100 from illuminance matching NUMBERS.md reference conditions', () => {
    // 100 000 lx clear noon -> log2(40000) = 15.2877
    expect(ev100FromLux(100_000)).toBeCloseTo(15.2877, 3);
    // 8 000 lx overcast -> log2(3200) = 11.6439
    expect(ev100FromLux(8_000)).toBeCloseTo(11.6439, 3);
    // 12 000 lx golden hour -> log2(4800) = 12.2288
    expect(ev100FromLux(12_000)).toBeCloseTo(12.2288, 3);
  });

  it('keeps an 18 % horizontal grey card consistently exposed across all lighting presets', () => {
    // By definition of incident EV100 metering: E_h * exposure(EV100) = 1 / 0.48,
    // so horizontal 18 % Lambertian reflectance exposes to 0.18 / (0.48 * pi) ~= 0.11937 linear.
    const targetLinear = CALIBRATION.greyReflectanceLinear / (0.48 * Math.PI);
    for (const preset of Object.values(LIGHTING_PRESETS)) {
      const ev = presetAnchorEv100(preset.sunIlluminanceLux, preset.skyIlluminanceLux, preset.sunElevationDeg);
      const sinElev = Math.sin((preset.sunElevationDeg * Math.PI) / 180);
      const exposed = expectedExposedLambertian(
        CALIBRATION.greyReflectanceLinear,
        preset.sunIlluminanceLux,
        sinElev,
        preset.skyIlluminanceLux,
        ev,
      );
      expect(exposed).toBeCloseTo(targetLinear, 4);
      // Pre-exposure keeps noon sun well below FP16 max (65504).
      expect(preset.sunIlluminanceLux * exposureFromEv100(ev)).toBeLessThan(10);
    }
  });

  it('normalises kelvin linear RGB to unit luminance and orders colour temperatures correctly', () => {
    const warm = kelvinToLinearRgb(3200);
    const noon = kelvinToLinearRgb(5500);
    const sky = kelvinToLinearRgb(10_000);
    for (const c of [warm, noon, sky]) {
      const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      expect(lum).toBeCloseTo(1.0, 5);
    }
    expect(warm.r / warm.b).toBeGreaterThan(noon.r / noon.b);
    expect(noon.r / noon.b).toBeGreaterThan(sky.r / sky.b);
  });

  it('round-trips sRGB <-> linear and produces unit sun vectors', () => {
    for (const v of [0, 0.02, 0.18, 0.5, 0.85, 1]) {
      expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 6);
    }
    const d = sunDirectionFromAngles(65, 35);
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6);
    expect(d.y).toBeCloseTo(Math.sin((65 * Math.PI) / 180), 6);
  });
});
