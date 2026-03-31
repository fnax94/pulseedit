# SaaS Design Patterns Research — Pulse Edit Site Redesign

**Date**: 2026-03-31
**Focus**: CSS design patterns from top dark-theme SaaS landing pages (Linear, Framer, Raycast, Arc, Warp, Superhuman)

---

## 1. Hero Gradient Glow Effects

### Pattern: Radial Gradient Orbs
Premium dark-theme SaaS sites use layered radial gradients to create glowing orb effects that add depth to hero sections without relying on images.

**CSS Code**:
```css
/* Hero background with multiple radial gradient orbs */
.hero {
  background:
    radial-gradient(at 41% 17%, hsla(278, 78%, 67%, 1) 0px, transparent 50%),
    radial-gradient(at 0% 9%, hsla(9, 90%, 77%, 1) 0px, transparent 50%),
    radial-gradient(at 89% 51%, hsla(204, 90%, 68%, 1) 0px, transparent 50%),
    radial-gradient(at 100% 100%, #0a0a0a 0px, #0a0a0a 100%);
  background-color: #0a0a0a;
  position: relative;
  overflow: hidden;
}

/* Individual orb element (alternative approach) */
.orb {
  position: absolute;
  width: 400px;
  height: 400px;
  background: radial-gradient(circle at 30% 30%, rgba(100, 200, 255, 0.4), transparent 70%);
  border-radius: 50%;
  filter: blur(40px);
  opacity: 0.6;
}
```

### Pattern: Blur Orb with Animation
```css
.hero-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
  animation: drift 8s ease-in-out infinite;
}

.orb-1 {
  width: 300px;
  height: 300px;
  background: radial-gradient(circle, rgba(139, 92, 246, 0.3), transparent);
  top: -50px;
  right: -100px;
}

.orb-2 {
  width: 250px;
  height: 250px;
  background: radial-gradient(circle, rgba(59, 130, 246, 0.25), transparent);
  bottom: -100px;
  left: 10%;
  animation-delay: 2s;
}

@keyframes drift {
  0%, 100% { transform: translate(0, 0); }
  25% { transform: translate(30px, -30px); }
  50% { transform: translate(-20px, 20px); }
  75% { transform: translate(20px, 10px); }
}
```

### Pattern: Conic Gradient Highlight (Stripe-inspired)
```css
.gradient-highlight {
  position: absolute;
  width: 500px;
  height: 500px;
  background: conic-gradient(
    from 0deg,
    rgba(255, 255, 255, 0.1),
    rgba(255, 255, 255, 0),
    rgba(255, 255, 255, 0.1)
  );
  border-radius: 50%;
  filter: blur(40px);
  animation: rotate 20s linear infinite;
}

@keyframes rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

---

## 2. Glassmorphism Card Styles

### Pattern: Premium Glass Card with Border Glow
Modern SaaS pricing cards use glassmorphism for a premium, frosted appearance with subtle border glow effects.

**CSS Code**:
```css
.glass-card {
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 16px;
  padding: 2rem;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.1),
    inset 1px 1px 0 rgba(255, 255, 255, 0.1);
  position: relative;
  overflow: hidden;
}

.glass-card::before {
  content: '';
  position: absolute;
  top: -50%;
  right: -50%;
  width: 100%;
  height: 100%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.05), transparent);
  animation: shimmer 3s ease-in-out infinite;
}

@keyframes shimmer {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.7; }
}
```

### Pattern: Glass Card with Glow Border on Hover
```css
.glass-card-interactive {
  background: rgba(10, 10, 10, 0.5);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 1.5rem;
  position: relative;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.glass-card-interactive::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 12px;
  padding: 1px;
  background: linear-gradient(
    135deg,
    rgba(59, 130, 246, 0.5),
    rgba(139, 92, 246, 0.3),
    rgba(59, 130, 246, 0.1)
  );
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.glass-card-interactive:hover::before {
  opacity: 1;
}

.glass-card-interactive:hover {
  background: rgba(10, 10, 10, 0.6);
  box-shadow: 0 20px 50px rgba(59, 130, 246, 0.1);
}
```

### Pattern: Multi-Layer Shadow System (Raycast-inspired)
```css
.premium-card {
  background: linear-gradient(135deg, rgba(50, 20, 100, 0.3), rgba(100, 50, 150, 0.2));
  border-radius: 12px;
  box-shadow:
    inset 1px 1px 0 rgba(255, 255, 255, 0.1),      /* Inner highlight */
    0 20px 25px -5px rgba(0, 0, 0, 0.1),            /* Mid-depth */
    0 40px 60px -15px rgba(0, 0, 0, 0.3);           /* Far shadow */
  padding: 1.5rem;
}
```

---

## 3. Scroll Animation CSS Classes

### Pattern: Fade-In-Up on Scroll
```css
.fade-in-up {
  opacity: 0;
  transform: translateY(30px);
  transition: opacity 0.6s ease-out, transform 0.6s ease-out;
}

.fade-in-up.visible {
  opacity: 1;
  transform: translateY(0);
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(40px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-fade-in-up {
  animation: fadeInUp 0.8s ease-out forwards;
}
```

### Pattern: Scale-In Effect
```css
@keyframes scaleIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.scale-in {
  animation: scaleIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}
```

### Pattern: Staggered Animation for Multiple Elements
```css
.stagger-container > * {
  animation: fadeInUp 0.6s ease-out forwards;
}

.stagger-container > *:nth-child(1) { animation-delay: 0ms; }
.stagger-container > *:nth-child(2) { animation-delay: 100ms; }
.stagger-container > *:nth-child(3) { animation-delay: 200ms; }
.stagger-container > *:nth-child(4) { animation-delay: 300ms; }
.stagger-container > *:nth-child(5) { animation-delay: 400ms; }
```

### Pattern: Scroll-Driven Animation (Modern browsers)
```css
.scroll-animate {
  animation: fadeInUp linear forwards;
  animation-timeline: view();
  animation-range: entry 0% cover 30%;
}

@supports (animation-timeline: view()) {
  .scroll-animate {
    animation-timeline: view();
  }
}
```

---

## 4. Dark Theme Color Palettes

### Premium SaaS Color System
```css
:root {
  /* Neutral base */
  --color-black: #000000;
  --color-white: #ffffff;
  --color-gray-950: #0a0a0a;
  --color-gray-900: #111111;
  --color-gray-800: #1a1a1a;
  --color-gray-700: #2d2d2d;
  --color-gray-600: #404040;
  --color-gray-500: #525252;
  --color-gray-400: #737373;
  --color-gray-300: #a3a3a3;
  --color-gray-200: #d4d4d4;
  --color-gray-100: #e5e5e5;

  /* Primary accent - Cool blue (technical, trustworthy) */
  --color-primary-50: #f0f9ff;
  --color-primary-100: #e0f2fe;
  --color-primary-200: #bae6fd;
  --color-primary-500: #0ea5e9;
  --color-primary-600: #0284c7;
  --color-primary-700: #0369a1;
  --color-primary-900: #082f49;

  /* Secondary accent - Purple (premium, creative) */
  --color-secondary-400: #a78bfa;
  --color-secondary-500: #8b5cf6;
  --color-secondary-600: #7c3aed;

  /* Semantic colors */
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-error: #ef4444;

  /* Text hierarchy */
  --text-primary: #ffffff;
  --text-secondary: #a3a3a3;
  --text-tertiary: #737373;

  /* Backgrounds */
  --bg-primary: #0a0a0a;
  --bg-secondary: #111111;
  --bg-tertiary: #1a1a1a;
}
```

### Alternative: Jewel Tone Palette (Premium feel)
```css
:root[data-theme="jewel"] {
  --color-bg: #0f0f1e;
  --color-surface: #1a1a2e;
  --color-accent-teal: #00d4d4;
  --color-accent-purple: #b366ff;
  --color-accent-cyan: #00f0ff;
  --text-primary: #f5f5f5;
  --text-secondary: #b0b0b0;
}
```

---

## 5. Typography Spacing System

### Spacing Scale (4px base unit)
```css
:root {
  /* Spacing scale: 0.25rem = 4px base */
  --space-0: 0;
  --space-1: 0.25rem;      /* 4px */
  --space-2: 0.5rem;       /* 8px */
  --space-3: 0.75rem;      /* 12px */
  --space-4: 1rem;         /* 16px */
  --space-6: 1.5rem;       /* 24px */
  --space-8: 2rem;         /* 32px */
  --space-10: 2.5rem;      /* 40px */
  --space-12: 3rem;        /* 48px */
  --space-16: 4rem;        /* 64px */
  --space-20: 5rem;        /* 80px */
}
```

### Typography System
```css
:root {
  /* Font sizes */
  --text-xs: 0.75rem;      /* 12px */
  --text-sm: 0.875rem;     /* 14px */
  --text-base: 1rem;       /* 16px */
  --text-lg: 1.125rem;     /* 18px */
  --text-xl: 1.25rem;      /* 20px */
  --text-2xl: 1.5rem;      /* 24px */
  --text-3xl: 1.875rem;    /* 30px */
  --text-4xl: 2.25rem;     /* 36px */
  --text-5xl: 3rem;        /* 48px */
  --text-6xl: 3.75rem;     /* 60px */

  /* Line heights */
  --line-tight: 1.25;
  --line-normal: 1.5;
  --line-relaxed: 1.75;

  /* Font weights */
  --font-light: 300;
  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;

  /* Letter spacing */
  --track-tight: -0.02em;
  --track-normal: 0;
  --track-wide: 0.02em;
}

h1 {
  font-size: var(--text-5xl);
  line-height: var(--line-tight);
  font-weight: var(--font-bold);
  letter-spacing: var(--track-tight);
  margin-bottom: var(--space-4);
}

h2 {
  font-size: var(--text-3xl);
  line-height: var(--line-tight);
  font-weight: var(--font-semibold);
  margin-bottom: var(--space-6);
}

body {
  font-size: var(--text-base);
  line-height: var(--line-normal);
  color: var(--text-primary);
}

.text-muted {
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
```

---

## 6. Hover Micro-Interactions

### Pattern: Scale + Glow on Hover
```css
.button-premium {
  background: linear-gradient(135deg, #0ea5e9, #8b5cf6);
  border: none;
  border-radius: 8px;
  padding: 0.75rem 1.5rem;
  color: #ffffff;
  font-weight: 600;
  cursor: pointer;
  transition:
    transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
    box-shadow 0.2s ease-out;
}

.button-premium:hover {
  transform: scale(1.05);
  box-shadow:
    0 0 20px rgba(14, 165, 233, 0.5),
    0 0 40px rgba(139, 92, 246, 0.3);
}

.button-premium:active {
  transform: scale(0.98);
}
```

### Pattern: Translate + Opacity on Hover
```css
.card-interactive {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
}

.card-interactive:hover {
  transform: translateY(-8px);
  box-shadow: 0 30px 60px rgba(0, 0, 0, 0.3);
}

.card-interactive .overlay {
  opacity: 0;
  transition: opacity 0.3s ease;
}

.card-interactive:hover .overlay {
  opacity: 1;
}
```

### Pattern: Color Shift on Hover
```css
.cta-link {
  color: var(--color-primary-500);
  position: relative;
  font-weight: 600;
  transition: color 0.3s ease;
}

.cta-link::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 0;
  width: 0%;
  height: 2px;
  background: var(--color-primary-500);
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.cta-link:hover::after {
  width: 100%;
}

.cta-link:hover {
  color: var(--color-primary-400);
}
```

### Pattern: Icon Rotation on Hover
```css
.feature-card {
  display: flex;
  gap: 1rem;
}

.feature-icon {
  width: 48px;
  height: 48px;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.feature-card:hover .feature-icon {
  transform: rotate(6deg) scale(1.1);
}
```

---

## 7. Pricing Card Premium Effects

### Pattern: Highlighted Pricing Card
```css
.pricing-cards {
  display: grid;
  gap: 2rem;
}

.pricing-card {
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 2rem;
  transition: all 0.3s ease;
  position: relative;
}

.pricing-card.highlighted {
  border-color: var(--color-primary-500);
  background: rgba(14, 165, 233, 0.08);
  transform: scale(1.05);
  box-shadow:
    0 20px 50px rgba(14, 165, 233, 0.2),
    0 0 1px rgba(14, 165, 233, 0.5);
}

.pricing-card.highlighted::before {
  content: 'POPULAR';
  position: absolute;
  top: -12px;
  left: 50%;
  transform: translateX(-50%);
  background: linear-gradient(135deg, #0ea5e9, #8b5cf6);
  color: white;
  padding: 0.25rem 1rem;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.05em;
}
```

### Pattern: Price Display with Gradient Text
```css
.price {
  font-size: 3rem;
  font-weight: 700;
  background: linear-gradient(135deg, #0ea5e9, #8b5cf6);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 0.5rem;
}

.price::after {
  content: '/mo';
  display: inline-block;
  font-size: 1rem;
  color: var(--text-secondary);
  margin-left: 0.5rem;
}
```

### Pattern: Feature List with Checkmarks
```css
.feature-list {
  list-style: none;
  padding: 0;
  margin: var(--space-6) 0;
}

.feature-list li {
  display: flex;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  align-items: center;
}

.feature-list li::before {
  content: '✓';
  color: var(--color-primary-500);
  font-weight: bold;
  flex-shrink: 0;
}

.feature-list li.unavailable::before {
  content: '✗';
  color: var(--text-tertiary);
}

.feature-list li.unavailable {
  color: var(--text-tertiary);
}
```

---

## 8. Additional Premium Techniques

### Pattern: Gradient Border Animation
```css
.gradient-border {
  position: relative;
  padding: 2rem;
  border-radius: 12px;
}

.gradient-border::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 12px;
  padding: 1px;
  background: linear-gradient(
    90deg,
    var(--color-primary-500),
    var(--color-secondary-500),
    var(--color-primary-500)
  );
  background-size: 200% 100%;
  animation: gradientShift 3s ease infinite;
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}

@keyframes gradientShift {
  0%, 100% { background-position: 0% center; }
  50% { background-position: 100% center; }
}
```

### Pattern: Floating Animation
```css
@keyframes float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-10px); }
}

.element-float {
  animation: float 3s ease-in-out infinite;
}
```

### Pattern: Glassmorphic Navigation
```css
.nav {
  position: fixed;
  top: 0;
  width: 100%;
  background: rgba(10, 10, 10, 0.8);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding: 1rem 2rem;
  z-index: 1000;
}
```

---

## Implementation Notes

1. **Blur Values**: Use 8-15px for cards, 20-40px for background orbs. Reduce to 6-8px on mobile.
2. **Opacity Ranges**:
   - Glass cards: rgba(255, 255, 255, 0.08) to rgba(255, 255, 255, 0.15)
   - Borders: rgba(255, 255, 255, 0.1) to rgba(255, 255, 255, 0.2)
3. **Animation Duration**: 150-300ms for micro-interactions, 600-800ms for scroll reveals
4. **Easing**: Use `cubic-bezier(0.4, 0, 0.2, 1)` for smooth, professional feel
5. **Performance**: Limit glassmorphic elements to 2-3 per viewport, animate only `transform` and `opacity`
6. **Browser Support**: All modern browsers support backdrop-filter except Firefox (disabled by default)

---

## Sources

- [Linear App Style Design Patterns — Medium](https://medium.com/design-bootcamp/the-rise-of-linear-style-design-origins-trends-and-techniques-4fd96aab7646)
- [Linear Style Documentation](https://linear.style/)
- [Raycast Design System](https://www.raycast.com)
- [Glassmorphism CSS Tutorial — ExclusiveAddons](https://exclusiveaddons.com/glassmorphism-css-tutorial/)
- [CSS Radial Gradient Recipes — CSS-Tricks](https://css-tricks.com/radial-gradient-recipes/)
- [CSS Scroll Animations — Alvarotrigo Blog](https://alvarotrigo.com/blog/css-animations-scroll/)
- [SaaS UI Color Palettes — Octet Design](https://octet.design/colors/user-interfaces/saas-ui-design/)
- [CSS Hover Effects Guide — Prismic](https://prismic.io/blog/css-hover-effects)
- [CSS Micro-interactions — Pixel Free Studio](https://blog.pixelfreestudio.com/how-to-use-css-for-creating-stunning-micro-interactions/)
- [Glassmorphism Design Trend — Developer Playground](https://playground.halfaccessible.com/blog/glassmorphism-design-trend-implementation-guide)
