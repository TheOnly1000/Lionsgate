---
name: Luminous Registry
colors:
  surface: '#f8f9fa'
  surface-dim: '#d9dadb'
  surface-bright: '#f8f9fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f5'
  surface-container: '#edeeef'
  surface-container-high: '#e7e8e9'
  surface-container-highest: '#e1e3e4'
  on-surface: '#191c1d'
  on-surface-variant: '#4d4635'
  inverse-surface: '#2e3132'
  inverse-on-surface: '#f0f1f2'
  outline: '#7f7663'
  outline-variant: '#d0c5af'
  surface-tint: '#735c00'
  primary: '#735c00'
  on-primary: '#ffffff'
  primary-container: '#d4af37'
  on-primary-container: '#554300'
  inverse-primary: '#e9c349'
  secondary: '#5f5e5e'
  on-secondary: '#ffffff'
  secondary-container: '#e2dfde'
  on-secondary-container: '#636262'
  tertiary: '#575f67'
  on-tertiary: '#ffffff'
  tertiary-container: '#abb4bd'
  on-tertiary-container: '#3d464d'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffe088'
  primary-fixed-dim: '#e9c349'
  on-primary-fixed: '#241a00'
  on-primary-fixed-variant: '#574500'
  secondary-fixed: '#e5e2e1'
  secondary-fixed-dim: '#c8c6c5'
  on-secondary-fixed: '#1c1b1b'
  on-secondary-fixed-variant: '#474746'
  tertiary-fixed: '#dbe4ed'
  tertiary-fixed-dim: '#bfc8d0'
  on-tertiary-fixed: '#141d23'
  on-tertiary-fixed-variant: '#3f484f'
  background: '#f8f9fa'
  on-background: '#191c1d'
  surface-variant: '#e1e3e4'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  code:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '450'
    lineHeight: 20px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 40px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 48px
---

## Brand & Style

This design system transitions from a moody, cinematic aesthetic to a high-clarity, professional enterprise environment. The brand personality is authoritative yet transparent, designed for high-stakes financial or administrative workflows where legibility and precision are paramount.

The style is **Corporate / Modern** with a focus on structural clarity. It utilizes a sophisticated white-label approach, where the interface recedes to let data take center stage. High-end refinement is maintained through the use of a singular luxury accent (gold) against a crisp, high-contrast backdrop. The emotional response should be one of confidence, stability, and meticulous organization.

## Colors

The palette is anchored in a neutral "Paper & Ink" philosophy. The background uses a soft off-white to reduce eye strain, while primary surfaces are pure white to create a clear layered hierarchy.

- **Primary (Gold):** Reserved exclusively for high-priority actions (CTA buttons), active states, and subtle branding accents.
- **Neutral (Grayscale):** A disciplined range of grays manages information density. Text follows a strict contrast ratio to ensure accessibility on light surfaces.
- **Status:** Success, Warning, and Error states should use high-chroma variants of green, amber, and red, respectively, but always paired with dark text or iconography to maintain the professional tone.

## Typography

The design system utilizes **Inter** exclusively to leverage its exceptional legibility in data-heavy interfaces. 

- **Hierarchy:** Use weight (SemiBold/Bold) rather than size to differentiate headers in dense tabular layouts.
- **Labels:** Small labels use uppercase with increased letter spacing to denote secondary metadata or section headers.
- **Numbers:** When displaying financial figures, ensure tabular lining figures are enabled to maintain vertical alignment in columns.

## Layout & Spacing

This design system follows a strict **8px grid** to ensure mathematical harmony across all components.

- **Grid:** A 12-column fluid grid is used for desktop, transitioning to a 4-column grid for mobile.
- **Density:** Maintain generous whitespace around key financial metrics to prevent cognitive overload.
- **Alignment:** All text elements must align to the baseline grid. Tables should use fixed headers with a 1px border separation for clear data segmentation.

## Elevation & Depth

Hierarchy is established through **Low-Contrast Outlines** and subtle tonal shifts rather than aggressive shadows.

- **Level 0 (Background):** #f8f9fa. Used for the main application canvas.
- **Level 1 (Surface):** #ffffff with a 1px border (#e9ecef). Used for cards, tables, and sidebar containers.
- **Level 2 (Interaction):** A very soft, diffused shadow (0px 4px 12px rgba(0,0,0,0.05)) is applied only to floating elements like dropdowns, modals, and popovers.
- **Depth:** Avoid skeuomorphism. Depth is communicated via "stacking" where higher elements appear closer due to their borders and slight shadow-casting on the level below.

## Shapes

The design system uses a **Rounded (Level 2)** shape language, which balances the rigidity of enterprise data with a modern, approachable feel.

- **Components:** Standard buttons and input fields utilize a 0.5rem (8px) corner radius.
- **Containers:** Larger cards and modals use 1rem (16px) to clearly define them as distinct sections of the application.
- **Iconography:** Use "Regular" weight line icons with slightly rounded caps to match the terminal radius of the typography.

## Components

- **Buttons:** 
  - *Primary:* Solid Gold (#d4af37) with white text. High contrast is essential.
  - *Secondary:* White background with a 1px border (#e9ecef) and dark text.
- **Input Fields:** 
  - Use a white background with #e9ecef borders. On focus, the border transitions to Gold (#d4af37) with a subtle 2px outer glow.
- **Status Badges:** 
  - Use a "Soft Fill" approach: a light tint of the status color for the background, and a high-contrast dark version of the same color for the text and icons.
- **Data Tables:** 
  - Zebra striping is not used. Instead, use thin #e9ecef horizontal dividers. Header rows should have a light gray background (#f8f9fa) to anchor the data.
- **Cards:** 
  - Minimalist white surfaces with a single-pixel border. Avoid shadows unless the card is draggable or a temporary overlay.