import type * as THREE from "three";

/** Root object of each visible session character, for the camera to focus on. Keyed by session id. */
export const characterRoots = new Map<string, THREE.Object3D>();
