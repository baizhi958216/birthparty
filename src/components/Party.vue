<template>
  <div
    ref="container"
    style="width: 100vw; height: 100vh; position: relative"
  >
    <div class="color-panel">
      <label>
        颜色模式：
        <select v-model="colorMode" @change="onColorModeChange">
          <option value="original">原图颜色</option>
          <option value="custom">自定义颜色</option>
        </select>
      </label>
      <template v-if="colorMode === 'custom'">
        <input type="color" v-model="customColorHex" @input="onCustomColorChange" />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRoute } from "vue-router";
import * as THREE from "three";
import { onMounted, ref } from "vue";
import cakeImg from "../assets/cake.png";
const container = ref<HTMLDivElement>();
const route = useRoute();

let geometry: THREE.BufferGeometry;
let material: THREE.PointsMaterial;
let particles: THREE.Points;
let PARTICLE_COUNT = 6000;
const POINT_SIZE = 2;
let MAX_OFFSET = 10;
let INFLUENCE_RADIUS = 100;
let positions: Float32Array;
let initialPositions: Float32Array;

// 颜色模式：'original'（原图色）或 'custom'（自定义色）
// import { reactive, watch, computed } from "vue";

const colorMode = ref<'original' | 'custom'>('original');
const customColor = ref<[number, number, number]>([1, 0.8, 0.24]);
// hex字符串用于input[type=color]
const customColorHex = ref('#facc3d');

function onColorModeChange() {
  loadImageAndGeneratePoints(cakeImg);
}
function onCustomColorChange(e: Event) {
  const hex = (e.target as HTMLInputElement).value;
  customColorHex.value = hex;
  // 转 rgb 数组
  const rgb = [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ] as [number, number, number];
  customColor.value = rgb;
  loadImageAndGeneratePoints(cakeImg);
}


// 初始化场景、相机、渲染器
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
const renderer = new THREE.WebGLRenderer({ antialias: true });

// 鼠标交互变量
const mouse = new THREE.Vector2();

// --- 点阵工具函数 ---
function extractTextPoints({
  text,
  fontSize,
  maxWidth,
  yOffset,
  scale,
  name,
}: {
  text: string;
  fontSize: number;
  maxWidth: number;
  yOffset: number;
  scale: number;
  name?: string;
}) {
  const textCanvas = document.createElement("canvas");
  const textCtx = textCanvas.getContext("2d")!;
  textCtx.font = `bold ${fontSize}px sans-serif`;
  let textWidth = textCtx.measureText(text).width;
  let fs = fontSize;
  // 缩小字体直到适配
  while (textWidth > maxWidth && fs > 12) {
    fs -= 2;
    textCtx.font = `bold ${fs}px sans-serif`;
    textWidth = textCtx.measureText(text).width;
  }
  textCanvas.width = Math.ceil(textWidth) + 20;
  textCanvas.height = fs + 20;
  textCtx.font = `bold ${fs}px sans-serif`;
  textCtx.fillStyle = "#fff";
  textCtx.textBaseline = "top";
  textCtx.fillText(text, 10, 10);
  const textData = textCtx.getImageData(
    0,
    0,
    textCanvas.width,
    textCanvas.height
  ).data;
  const points: number[] = [];
  const colors: number[] = [];
  const step = 2;
  let nameStartX = null,
    nameEndX = null;
  if (name) {
    // 计算 name 在画布中的 x 范围
    const before = text.split(name)[0];
    textCtx.font = `bold ${fs}px sans-serif`;
    const beforeWidth = textCtx.measureText(before).width;
    const nameWidth = textCtx.measureText(name).width;
    nameStartX = 10 + beforeWidth;
    nameEndX = nameStartX + nameWidth;
  }
  for (let y = 0; y < textCanvas.height; y += step) {
    for (let x = 0; x < textCanvas.width; x += step) {
      const idx = (y * textCanvas.width + x) * 4;
      if (textData[idx + 3] > 128) {
        points.push(
          (x - textCanvas.width / 2) * scale,
          (textCanvas.height / 2 - y) * scale + yOffset,
          0
        );
        // 判断是否属于 name 区域
        let color = [1, 1, 1]; // 默认白色
        if (
          name &&
          nameStartX !== null &&
          nameEndX !== null &&
          x >= nameStartX &&
          x <= nameEndX
        ) {
          // #FACC3D 转 rgb
          color = [250 / 255, 204 / 255, 61 / 255];
        }
        colors.push(...color);
      }
    }
  }
  return { points, colors };
}

function extractCakePoints(img: HTMLImageElement, yOffset: number): { points: number[]; colors: number[] } {
  const maxDim = 120;
  let w = img.width,
    h = img.height;
  if (Math.max(w, h) > maxDim) {
    if (w > h) {
      h = Math.round((h * maxDim) / w);
      w = maxDim;
    } else {
      w = Math.round((w * maxDim) / h);
      h = maxDim;
    }
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const points: number[] = [];
  const colors: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = data[idx],
        g = data[idx + 1],
        b = data[idx + 2],
        a = data[idx + 3];
      if (a > 100 && r + g + b > 100) {
        points.push((x - w / 2) * 4, (h / 2 - y) * 4 + yOffset, 0);
        colors.push(r / 255, g / 255, b / 255);
      }
    }
  }
  return { points, colors };
}
// 加载图片并生成点云（主入口）
function loadImageAndGeneratePoints(imgSrc: string, name?: string) {
  // 1. 生成文字点阵
  const containerWidth = container.value?.clientWidth || window.innerWidth;
  const maxTextWidth = containerWidth * 0.5 * 0.8;
  let displayName = name || (route?.params?.name as string) || "";
  let text = displayName
    ? `Happy birthday to ${displayName}`
    : "Happy birthday to you";

  const { points: textPoints, colors: textColors } = extractTextPoints({
    text,
    fontSize: 36,
    maxWidth: maxTextWidth,
    yOffset: 220,
    scale: 2,
    name: displayName || undefined,
  });

  // 2. 加载蛋糕点阵
  const img = new window.Image();
  img.onload = function () {
    const { points: cakePoints, colors: cakeColors } = extractCakePoints(img, -80);
    // 合并点阵
    const allPoints = textPoints.concat(cakePoints);
    // 合并颜色
    let allColors: number[];
    if(colorMode.value === 'original') {
      allColors = textColors.concat(cakeColors);
    } else {
      // 全部用 customColor 填充
      allColors = [];
      const totalPoints = textPoints.length / 3 + cakePoints.length / 3;
      for(let i=0; i<totalPoints; i++) {
        allColors.push(...customColor.value);
      }
    }
    // 随机采样
    let sampled = allPoints;
    let sampledColors = allColors;
    if (allPoints.length / 3 > PARTICLE_COUNT) {
      const indices = Array.from({ length: allPoints.length / 3 }, (_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      const sel = indices.slice(0, PARTICLE_COUNT);
      sampled = sel.flatMap((i: number) => allPoints.slice(i * 3, i * 3 + 3));
      sampledColors = sel.flatMap((i: number) =>
        allColors.slice(i * 3, i * 3 + 3)
      );
    }
    // 更新 positions
    positions = new Float32Array(PARTICLE_COUNT * 3);
    initialPositions = new Float32Array(PARTICLE_COUNT * 3);
    const colorsArr = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      if (i < sampled.length / 3) {
        positions[i * 3] = sampled[i * 3];
        positions[i * 3 + 1] = sampled[i * 3 + 1];
        positions[i * 3 + 2] = sampled[i * 3 + 2];
        initialPositions[i * 3] = sampled[i * 3];
        initialPositions[i * 3 + 1] = sampled[i * 3 + 1];
        initialPositions[i * 3 + 2] = sampled[i * 3 + 2];
        colorsArr[i * 3] = sampledColors[i * 3];
        colorsArr[i * 3 + 1] = sampledColors[i * 3 + 1];
        colorsArr[i * 3 + 2] = sampledColors[i * 3 + 2];
      } else {
        positions[i * 3] = positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = 10000; // z很远
        initialPositions[i * 3] = initialPositions[i * 3 + 1] = 0;
        initialPositions[i * 3 + 2] = 10000;
        colorsArr[i * 3] = colorsArr[i * 3 + 1] = colorsArr[i * 3 + 2] = 0;
      }
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colorsArr, 3));
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  };
  img.src = imgSrc;
}

// 更新点位置
function animate() {
  requestAnimationFrame(animate);

  // 将鼠标 NDC 坐标转换为场景中的 3D 坐标（假设在相机近平面）
  const vector = new THREE.Vector3(mouse.x, mouse.y, 0.5);
  vector.unproject(camera);
  const dir = vector.sub(camera.position).normalize();
  const distance = -camera.position.z / dir.z; // 相交于 z=0 平面
  const mousePos = camera.position.clone().add(dir.multiplyScalar(distance));

  // 遍历所有点，计算与鼠标的距离并更新位置
  const posArray = geometry.attributes.position.array;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    // 当前点的初始位置
    const ix = initialPositions[i * 3];
    const iy = initialPositions[i * 3 + 1];
    const iz = initialPositions[i * 3 + 2];

    // 计算当前点与鼠标的距离
    const dx = ix - mousePos.x;
    const dy = iy - mousePos.y;
    const dz = iz - mousePos.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // 根据距离计算偏移量（距离越近，偏移越大）
    let offsetX = 0,
      offsetY = 0,
      offsetZ = 0;
    if (distance < INFLUENCE_RADIUS) {
      const force = (1 - distance / INFLUENCE_RADIUS) * MAX_OFFSET;
      // 方向：从鼠标指向点（排斥效果）
      offsetX = (dx / distance) * force;
      offsetY = (dy / distance) * force;
      offsetZ = (dz / distance) * force;
    }

    // 更新当前点位置（初始位置 + 偏移量）
    posArray[i * 3] = ix + offsetX;
    posArray[i * 3 + 1] = iy + offsetY;
    posArray[i * 3 + 2] = iz + offsetZ;
  }

  // 通知 Three.js 几何体位置已更新
  geometry.attributes.position.needsUpdate = true;

  renderer.render(scene, camera);
}

onMounted(() => {
  if (container.value?.clientWidth! < 512) {
    MAX_OFFSET = INFLUENCE_RADIUS = 0;
  }
  renderer.setSize(container.value!.clientWidth, container.value!.clientHeight);
  renderer.setClearColor(0x242424); // 深色背景
  container.value!.appendChild(renderer.domElement);

  // 相机位置
  camera.position.z = 500;

  // 初始化空点阵
  positions = new Float32Array(0);
  initialPositions = new Float32Array(0);
  geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  loadImageAndGeneratePoints(cakeImg);

  // 设置点材质
  material = new THREE.PointsMaterial({
    size: POINT_SIZE,
    color: 0xffffff, // 白色点
    transparent: true,
    opacity: 0.8,
    sizeAttenuation: true, // 点大小随距离衰减（更真实）
    vertexColors: true, // 启用每个点自定义颜色
  });

  // 创建点对象
  particles = new THREE.Points(geometry, material);
  scene.add(particles);

  // 监听鼠标移动
  window.addEventListener("mousemove", (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  });

  // 处理窗口大小变化
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // 启动动画
  animate();
});
</script>

<style scoped>
.color-panel {
  position: absolute;
  top: 18px;
  left: 18px;
  z-index: 10;
  background: rgba(30, 30, 30, 0.93);
  padding: 8px 14px 8px 12px;
  border-radius: 8px;
  box-shadow: 0 2px 8px #0004, 0 1px 2px #fff1 inset;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14.5px;
  color: #fff;
  font-weight: 500;
  letter-spacing: 0.5px;
  user-select: none;
}
.color-panel label {
  display: flex;
  align-items: center;
  gap: 7px;
}
.color-panel select {
  font-size: 13px;
  padding: 2px 10px 2px 6px;
  border-radius: 5px;
  border: none;
  background: #232323;
  color: #fff;
  font-weight: 500;
  outline: none;
  transition: box-shadow 0.2s, background 0.2s;
  box-shadow: 0 1px 2px #0002;
}
.color-panel select:hover {
  background: #333;
}
.color-panel input[type="color"] {
  margin-left: 6px;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 5px;
  box-shadow: 0 1px 3px #0002;
  cursor: pointer;
  background: #fff;
  transition: box-shadow 0.2s;
}
.color-panel input[type="color"]:hover {
  box-shadow: 0 2.5px 16px #0005;
}
</style>

