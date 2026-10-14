/*
 * WAGWANSPARK — Shader Gradient
 * A lightweight WebGL fragment-shader gradient that runs as a separate
 * animated background layer behind the chrome emblem in the Beats hero.
 *
 * Falls back to a static CSS gradient (hero-shader-fallback) when WebGL
 * is unavailable or the user prefers reduced motion. Pauses when the
 * hero scrolls off-screen and when the tab is hidden, for battery.
 * Renders at half resolution on mobile for performance.
 */
(() => {
  "use strict";

  function init() {
    const canvas = document.getElementById("heroShader");
    if (!canvas) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      canvas.style.display = "none";
      return;
    }

    const gl = canvas.getContext("webgl", {
      antialias: false,
      alpha: false,
      premultipliedAlpha: false,
      powerPreference: "low-power"
    });

    if (!gl) {
      canvas.style.display = "none";
      return;
    }

    /* ---- Shaders ---- */
    const vertexSrc = `
      attribute vec2 a_position;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    // Organic flowing gradient using fractal Brownian motion noise.
    // Palette: deep charcoal base, subtle electric-lime, cyan and violet
    // drifts — all kept low-intensity so the chrome emblem stays dominant.
    const fragmentSrc = `
      precision mediump float;
      uniform float u_time;
      uniform vec2 u_resolution;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * noise(p);
          p *= 2.0;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution.xy;
        vec2 p = uv * 3.0;
        float t = u_time * 0.12;

        float n1 = fbm(p + vec2(t, t * 0.5));
        float n2 = fbm(p + vec2(-t * 0.7, t * 0.3) + n1);

        vec3 base   = vec3(0.030, 0.030, 0.038);
        vec3 lime   = vec3(0.80, 1.0, 0.0)  * 0.13;
        vec3 cyan   = vec3(0.30, 0.93, 0.92) * 0.08;
        vec3 violet = vec3(0.46, 0.29, 0.64) * 0.10;

        vec3 color = mix(base, lime, smoothstep(0.30, 0.70, n1));
        color = mix(color, cyan, smoothstep(0.40, 0.80, n2) * 0.5);
        color = mix(color, violet, smoothstep(0.20, 0.60, n1 * n2) * 0.35);

        float vignette = 1.0 - length(uv - 0.5) * 0.75;
        color *= clamp(vignette, 0.0, 1.0);

        gl_FragColor = vec4(color, 1.0);
      }
    `;

    function compile(type, src) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    const vs = compile(gl.VERTEX_SHADER, vertexSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fragmentSrc);
    if (!vs || !fs) {
      canvas.style.display = "none";
      return;
    }

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      canvas.style.display = "none";
      return;
    }
    gl.useProgram(program);

    // Full-screen quad (two triangles)
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    const posLoc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const timeLoc = gl.getUniformLocation(program, "u_time");
    const resLoc = gl.getUniformLocation(program, "u_resolution");

    // Mobile: half-resolution drawing buffer for GPU performance.
    const scale = window.innerWidth < 768 ? 0.5 : 1.0;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width * scale));
      const h = Math.max(1, Math.floor(rect.height * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    resize();
    window.addEventListener("resize", resize, { passive: true });

    let running = true;
    let elapsed = 0;
    let lastTime = performance.now();
    let rafId = null;

    function render() {
      if (!running) return;
      const now = performance.now();
      elapsed += (now - lastTime) / 1000;
      lastTime = now;
      gl.uniform1f(timeLoc, elapsed);
      gl.uniform2f(resLoc, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      rafId = requestAnimationFrame(render);
    }

    // Pause when the hero scrolls off-screen.
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting && !running) {
            running = true;
            lastTime = performance.now();
            rafId = requestAnimationFrame(render);
          } else if (!entry.isIntersecting && running) {
            running = false;
            if (rafId) cancelAnimationFrame(rafId);
          }
        });
      },
      { threshold: 0 }
    );
    observer.observe(canvas);

    // Pause when the tab is hidden.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && running) {
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
      } else if (!document.hidden && !running) {
        // IntersectionObserver will re-start if visible.
      }
    });

    rafId = requestAnimationFrame(render);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
