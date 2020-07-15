const createREGL = require('regl');
const State = require('controls-state');
const GUI = require('controls-gui');
const createCamera = require('./regl-turntable-camera');
const meshSurface = require('./mesh-surface-2d');
const mat4create = require('gl-mat4/create');
const mat4multiply = require('gl-mat4/multiply');
const mat4lookAt = require('gl-mat4/lookAt');
const Preact = require('preact');
const createClass = require('preact-compat').createClass;
const h = Preact.h;

var css = require('insert-css');
var katex = require('katex');
var fs = require('fs');

var katexCss = fs.readFileSync(__dirname + '/../../node_modules/katex/dist/katex.min.css', 'utf8');

var fontFamily = 'Fira Sans Condensed';

css(katexCss);
css(`
@import url('https://fonts.googleapis.com/css?family=${fontFamily.replace(/ /g, '+')}');

html, body {
  margin: 0;
  padding: 0;
  background-color: black;
}

.sketch-nav {
  right: auto !important;
  left: 0 !important;
}

.control-panel {
  margin-bottom: 5em;
}

.rawContent {
  max-width: 100%;
}

.rawContent svg {
  max-width: 100%;
}

canvas {
  margin-left: auto;
  margin-right: auto;
  display: inline-block;
  position: fixed !important;
}
`)

function createDrawBoysSurface (regl, res, state) {
  const mesh = meshSurface({}, (out, u, v) => {
    out[0] = u;
    out[1] = v;
  }, {
    resolution: [70, 400],
    uDomain: [0, 1],
    vDomain: [-Math.PI, Math.PI],
  });

  return regl({
    vert: `
      precision highp float;
      attribute vec2 uv;
      uniform mat4 uProjection, uView;
      uniform vec2 rrange;
      varying vec3 vPosition, vNormal;
      varying vec2 vUV;

      vec2 csub (vec2 a, vec2 b) {
        return a - b;
      }

      vec2 cadd (vec2 a, vec2 b) {
        return a + b;
      }

      vec2 cdiv (vec2 a, vec2 b) {
        float e, f;
        float g = 1.0;
        float h = 1.0;
        if( abs(b.x) >= abs(b.y) ) {
          e = b.y / b.x;
          f = b.x + b.y * e;
          h = e;
        } else {
          e = b.x / b.y;
          f = b.x * e + b.y;
          g = e;
        }
        return (a * g + h * vec2(a.y, -a.x)) / f;
      }

      vec2 csqr (vec2 z) {
        return vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y);
      }

      vec2 cmul (vec2 a, vec2 b) {
        return vec2(a.x * b.x - a.y * b.y, a.y * b.x + a.x * b.y);
      }

      vec3 f(vec2 uv) {
        vec2 w = vec2(uv.x * vec2(cos(uv.y), sin(uv.y)));

        vec2 w2 = csqr(w);
        vec2 w3 = cmul(w2, w);
        vec2 w4 = csqr(w2);
        vec2 w6 = cmul(w2, w4);

        vec2 denom = csub(w6 + sqrt(5.0) * w3, vec2(1, 0));
        float g1 = -1.5 * cdiv(cmul(w, csub(vec2(1, 0), w4)), denom).y;
        float g2 = -1.5 * cdiv(cmul(w, cadd(vec2(1, 0), w4)), denom).x;
        float g3 = cdiv(cadd(vec2(1, 0), w6), csub(w6 + sqrt(5.0) * w3, vec2(1, 0))).y - 0.5;

        return vec3(g2, g3, g1) / (g1 * g1 + g2 * g2 + g3 * g3);
      }

      void main () {
        vUV = uv;
        vUV.x = mix(rrange.x, rrange.y, uv.x);
        vPosition = f(vUV);

        // Compute the normal via numerical differentiation
        const float dx = 1e-3;
        vNormal = normalize(cross(
          f(vUV + vec2(dx, 0)) - vPosition,
          f(vUV + vec2(0, dx)) - vPosition
        ));

        gl_Position = uProjection * uView * vec4(vPosition, 1);
      }
    `,
    frag: `

      #extension GL_OES_standard_derivatives : enable
    precision highp float;
    varying vec3 vPosition, vNormal;
    uniform vec3 uEye;
    uniform bool solidPass;
    varying vec2 vUV;
    uniform float pixelRatio, opacity, cartoonEdgeWidth, gridOpacity, specular, cartoonEdgeOpacity, gridWidth;

    // This function implements a constant-width grid as a function of
    // a two-dimensional input. This makes it possible to draw a grid
    // which does not line up with the triangle edges.
    // from: https://github.com/rreusser/glsl-solid-wireframe
    float gridFactor (vec2 parameter, float width, float feather) {
      float w1 = width - feather * 0.5;
      vec2 d = fwidth(parameter);
      vec2 looped = 0.5 - abs(mod(parameter, 1.0) - 0.5);
      vec2 a2 = smoothstep(d * w1, d * (w1 + feather), looped);
      return min(a2.x, a2.y);
    }

    #define PI 3.14159265358979
    uniform float strips, fill;

    void main () {
      if (fract(vUV.y * strips / (2.0 * PI)) < fill) discard;

      vec3 normal = normalize(vNormal);

      // The dot product of the view direction and surface normal.
      float vDotN = abs(dot(normal, normalize(vPosition - uEye)));

      // We divide vDotN by its gradient magnitude in screen space to
      // give a function which goes roughly from 0 to 1 over a single
      // pixel right at glancing angles. i.e. cartoon edges!
      float cartoonEdge = smoothstep(0.75, 1.25, vDotN / fwidth(vDotN) / (cartoonEdgeWidth * pixelRatio));

      // Combine the gridlines and cartoon edges
      float grid = gridFactor(vUV * vec2(12.0, 12.0 / PI), 0.5 * gridWidth * pixelRatio, 1.0);
      float combinedGrid = max(cartoonEdgeOpacity * (1.0 - cartoonEdge), gridOpacity * (1.0 - grid));

      if (solidPass) {
        // If the surface pass, we compute some shading
        float shade = 0.2 + mix(1.2, specular * pow(vDotN, 3.0), 0.5);
        vec3 colorFromNormal = (0.5 - (gl_FrontFacing ? 1.0 : -1.0) * 0.5 * normal);
        vec3 baseColor = gl_FrontFacing ? vec3(0.1, 0.4, 0.8) : vec3(0.9, 0.2, 0.1);

        vec3 color = shade * mix(
            baseColor,
            colorFromNormal,
            0.4
          );
        // Apply the gridlines
        color = mix(color, vec3(0), opacity * combinedGrid);
        gl_FragColor = vec4(pow(color, vec3(0.454)), 1.0);
      } else {
        // If the wireframe pass, we just draw black lines with some alpha
        gl_FragColor = vec4(
          // To get the opacity to mix ~correctly, we use reverse-add blending mode
          // so that white here shows up as black gridlines. This could be simplified
          // by doing a bit more math to get the mixing right with just additive blending.
          vec3(1),
          (1.0 - opacity) * combinedGrid
        );

        if (gl_FragColor.a < 1e-3) discard;
      }
    }
    `,
    uniforms: {
      solidPass: regl.prop('solidPass'),
      pixelRatio: regl.context('pixelRatio'),
      rrange: () => [state.rmin, state.rmax],
      strips: () => state.strips,
      fill: () => 1.0 - state.fill,
      cartoonEdgeOpacity: () => state.cartoonEdgeOpacity,
      cartoonEdgeWidth: () => state.cartoonEdgeWidth,
      gridWidth: () => state.gridWidth,
      gridOpacity: () => state.gridOpacity,
      opacity: () => state.opacity,
      specular: 1.0,
    },
    attributes: {uv: mesh.positions},
    depth: {enable: (ctx, props) => props.solidPass ? true : false},
    blend: {
      enable: (ctx, props) => props.solidPass ? false : true,
      func: {srcRGB: 'src alpha', srcAlpha: 1, dstRGB: 1, dstAlpha: 1},
      equation: {rgb: 'reverse subtract', alpha: 'add'}
    },
    elements: mesh.cells
  });
}

const regl = createREGL({extensions: ['OES_standard_derivatives']});

class Explanation extends Preact.Component {
  shouldComponentUpdate () {
    return false;
  }

  render () {
    function eqn (str, opts) {
      return h('span', Object.assign({dangerouslySetInnerHTML: {__html: katex.renderToString(str)}}, opts || {}));
    }
    return h('p', {},
      'A plot of ',
      h('a', {href: 'https://en.wikipedia.org/wiki/Boy%27s_surface'}, 'Boy\'s Surface'),
      ', a immersion of the non-orientable ',
      h('a', {href: 'https://en.wikipedia.org/wiki/Real_projective_plane'}, 'real projective plane'),
      ' into ',
      eqn(`\\mathbb{R}^3`),
      '. Based on the parameterization',
      h('br'),
      eqn(`
        \\displaystyle{
        \\begin{aligned}
          g_{1}& = -{3 \\over 2} \\operatorname{Im} \\left[ {w\\left(1-w^{4}\\right) \\over w^{6}+{\\sqrt {5}}w^{3}-1} \\right] \\\\
          g_{2}& = -{3 \\over 2} \\operatorname{Re} \\left[ {w\\left(1+w^{4}\\right) \\over w^{6}+{\\sqrt {5}}w^{3}-1} \\right] \\\\
          g_{3}& = \\operatorname {Im} \\left[{1+w^{6} \\over w^{6}+{\\sqrt {5}}w^{3}-1}\\right]-{1 \\over 2}
        \\end{aligned}}
      `, {style: {display: 'block', margin: '0.5em auto', textAlign: 'center'}}),
      'with coordinates',
      h('br'),
      eqn(`
        \\displaystyle {
          \\begin{pmatrix}x\\\\y\\\\z\\end{pmatrix}={
          \\frac{1}{g_{1}^{2}+g_{2}^{2}+g_{3}^{2}}}
          {\\begin{pmatrix}g_{1}\\\\g_{2}\\\\g_{3}\\end{pmatrix}}.
        }
      `, {style: {display: 'block', margin: '0.5em auto', textAlign: 'center'}}),
      'For complex ',eqn(`w`),', we plot a disc in the complex plane where ',eqn(`\\|w\\| \\leq 1`), '.'
    )
  }
}

const state = State({
  Info: State.Section({
    raw: State.Raw(h => {
      return h(Explanation);
    })
  }, {expanded: window.innerWidth > 500}),
  Rendering: State.Section({
    rmin: State.Slider(0, {min: 0, max: 1, step: 1e-3, label: 'disc inner radius'}),
    rmax: State.Slider(1, {min: 0, max: 1, step: 1e-3, label: 'disc outer radius'}),
    opacity: State.Slider(0.85, {min: 0, max: 1, step: 1e-3, label: 'surface opacity'}),
    gridWidth: State.Slider(1.0, {min: 0.5, max: 3, step: 1e-3, label: 'grid width'}),
    gridOpacity: State.Slider(0.4, {min: 0, max: 1, step: 1e-3, label: 'grid opacity'}),
    cartoonEdgeOpacity: State.Slider(1.0, {min: 0, max: 1, step: 1e-3, label: 'edge opacity'}),
    cartoonEdgeWidth: State.Slider(3.0, {min: 0, max: 5, step: 1e-3, label: 'edge width'}),
    strips: State.Slider(12, {min: 1, max: 24, step: 1, label: 'strip count'}),
    fill: State.Slider(1, {min: 0, max: 1, step: 1e-3, label: 'strip fill'}),
  }, {expanded: window.innerWidth > 500}),
});
GUI(state, {
  containerCSS: "position:absolute; top:0; right:10px; width:350px",
});

const camera = createCamera(regl, {
  distance: 5,
  center: [0, -0.5, 0],
  theta: -0.5,
  phi: 0.1,
  far: 100,
});

state.$onChange(camera.taint);

const drawTorus = createDrawBoysSurface(regl, 255, state.Rendering);

let frame = regl.frame(({tick, time}) => {
  camera(({dirty}) => {
    if (!dirty) return;
    regl.clear({color: [1, 1, 1, 1]});

    // Perform two drawing passes, first for the solid surface, then for the wireframe overlayed on top
    // to give a fake transparency effect
    drawTorus([
      {solidPass: true},
      {solidPass: false},
    ]);
  });
});