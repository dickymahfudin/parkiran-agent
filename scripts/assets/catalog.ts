// Every third-party environment asset. All CC0 from Poly Haven (https://polyhaven.com/license).

export interface ModelEntry {
  id: string;
  /** Max texture edge after optimisation. */
  textureSize: 256 | 512 | 1024;
}

export const POLYHAVEN_MODELS: ModelEntry[] = [
  { id: "painted_wooden_bench", textureSize: 1024 },
  { id: "plastic_crate_01", textureSize: 512 },
  { id: "plastic_crate_02", textureSize: 512 },
  { id: "plastic_bottle_gallon", textureSize: 512 },
  { id: "plastic_thermos", textureSize: 256 },
  { id: "cigarette_pack", textureSize: 256 },
  { id: "small_lpg_tank", textureSize: 512 },
  { id: "metal_trash_can", textureSize: 512 },
  { id: "potted_plant_04", textureSize: 1024 },
  { id: "planter_box_01", textureSize: 512 },
  { id: "street_lamp_01", textureSize: 512 },
  { id: "covered_car", textureSize: 1024 },
  { id: "old_tyre", textureSize: 512 },
  { id: "cardboard_box_01", textureSize: 512 },
  { id: "wooden_crate_01", textureSize: 512 },
  { id: "water_manhole_cover", textureSize: 512 },
  { id: "utility_box_01", textureSize: 512 },
  { id: "plastic_monobloc_chair_01", textureSize: 512 },
  { id: "trashbag", textureSize: 256 },
  { id: "lightbulb_01", textureSize: 256 },
];

/** PBR texture sets for procedural geometry (diffuse + GL normal + ARM). */
export const POLYHAVEN_TEXTURES: { id: string; size: 512 | 1024 }[] = [
  { id: "asphalt_02", size: 1024 },
  { id: "road_damaged", size: 1024 },
  { id: "concrete_pavement", size: 1024 },
  { id: "brushed_concrete", size: 512 },
  { id: "painted_plaster_wall", size: 1024 },
  { id: "blue_plaster_weathered", size: 1024 },
  { id: "rusty_metal_shutter", size: 1024 },
  { id: "corrugated_iron", size: 512 },
  { id: "weathered_planks", size: 512 },
  { id: "clay_roof_tiles", size: 512 },
  { id: "concrete_pavers", size: 1024 },
];

/** Sky + lighting per time band; blended by the day-night cycle. */
export const POLYHAVEN_HDRIS = [
  { id: "kiara_1_dawn", band: "morning" },
  { id: "kloofendal_48d_partly_cloudy_puresky", band: "noon" },
  { id: "belfast_sunset_puresky", band: "golden" },
  { id: "rogland_clear_night", band: "night" },
] as const;
