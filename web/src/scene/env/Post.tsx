import { Bloom, EffectComposer, N8AO, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";

/** AO grounds everything, bloom only catches HDR emissives (lamps, cigarette tips, neon), AgX tone mapping last. */
export function Post({ compact = false }: { compact?: boolean }) {
  return (
    <EffectComposer multisampling={compact ? 0 : 4} enableNormalPass={false}>
      <N8AO halfRes quality={compact ? "performance" : "medium"} aoRadius={0.7} distanceFalloff={0.9} intensity={1.6} />
      <Bloom mipmapBlur luminanceThreshold={1.05} luminanceSmoothing={0.25} intensity={0.75} radius={0.7} />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <Vignette offset={0.28} darkness={0.42} />
    </EffectComposer>
  );
}
