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

    // Organic flowing gradient using fractal Brownian motion noise with
    // domain warping for richer, more natural movement.
    // Palette: deep charcoal base, restrained silver, electric-lime, cyan,
    // violet and warm amber drifts — broad, slow, ambient atmosphere.
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
        for (int i = 0; i < 5; i++) {
          v += a * noise(p);
          p *= 2.0;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution.xy;
        vec2 p = uv * 2.5;
        float t = u_time * 0.07;

        // Domain warping: distort the noise field itself for organic flow
        vec2 q = vec2(
          fbm(p + vec2(t, t * 0.3)),
          fbm(p + vec2(-t * 0.4, t * 0.6) + 3.1)
        );

        vec2 r = vec2(
          fbm(p + 2.0 * q + vec2(1.7, 9.2) + t * 0.15),
          fbm(p + 2.0 * q + vec2(8.3, 2.8) - t * 0.1)
        );

        float n1 = fbm(p + 3.0 * r);
        float n2 = length(r);

        vec3 base   = vec3(0.024, 0.024, 0.028);
        vec3 lime   = vec3(0.80, 1.0, 0.0)   * 0.09;
        vec3 cyan   = vec3(0.30, 0.93, 0.92) * 0.06;
        vec3 violet = vec3(0.46, 0.29, 0.64) * 0.07;
        vec3 amber  = vec3(0.72, 0.52, 0.18) * 0.04;
        vec3 silver = vec3(0.72, 0.72, 0.74) * 0.05;

        vec3 color = mix(base, lime, smoothstep(0.28, 0.68, n1));
        color = mix(color, cyan, smoothstep(0.42, 0.82, n2) * 0.45);
        color = mix(color, violet, smoothstep(0.18, 0.58, n1 * n2) * 0.32);
        color = mix(color, amber, smoothstep(0.55, 0.85, n2) * 0.18);
        color = mix(color, silver, smoothstep(0.50, 0.80, n1) * 0.22);

        // Subtle film grain for texture
        float grain = hash(uv * u_resolution.xy + t * 60.0) * 0.015;
        color += grain - 0.0075;

        float vignette = 1.0 - length(uv - 0.5) * 0.62;
        color *= clamp(vignette, 0.0, 1.0);

        // Top and bottom fades: blend into the page background
        float topFade = smoothstep(0.0, 0.10, 1.0 - uv.y);
        float bottomFade = smoothstep(0.0, 0.20, uv.y);
        color = mix(vec3(0.024, 0.024, 0.028), color, min(topFade, bottomFade));

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
