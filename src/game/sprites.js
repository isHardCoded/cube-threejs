import * as THREE from 'three'
import { MAX_HP } from './dice.js'

let nameplateMaxHp = MAX_HP
export function setNameplateMaxHp(hp) {
  const n = Number(hp)
  nameplateMaxHp = Number.isFinite(n) && n > 0 ? n : MAX_HP
}

const PLATE_W = 160
const PLATE_H = 56

/** Overlay UI sprites — rendered after post so bloom/godrays never trail them. */
export const SPRITE_LAYER = 1

function tagOverlaySprite(sprite) {
  sprite.layers.set(SPRITE_LAYER)
  sprite.renderOrder = 10
  return sprite
}

// Nameplate: nickname + HP bar + dash strip, all on one sprite above the die.
export function createNameplate(name, isMe) {
  const c = document.createElement('canvas')
  c.width = PLATE_W
  c.height = PLATE_H
  const tex = new THREE.CanvasTexture(c)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: false,
  }))
  sprite.scale.set(1.25, 1.25 * (PLATE_H / PLATE_W), 1)
  tagOverlaySprite(sprite)
  return { sprite, ctx: c.getContext('2d'), tex, name: name || 'PLAYER', isMe }
}

// dashFrac: 0..1 readiness of the dash; null hides the dash strip (other players)
export function drawNameplate(bar, hp, dashFrac = null) {
  const { ctx, tex } = bar
  const w = PLATE_W
  ctx.clearRect(0, 0, w, PLATE_H)

  // nickname, mine highlighted in yellow
  ctx.font = 'bold 17px Verdana'
  ctx.textAlign = 'center'
  const nameColor = bar.isMe ? '#fcee0a' : '#eaf6ff'
  ctx.fillStyle = nameColor
  ctx.shadowColor = nameColor
  ctx.shadowBlur = 6
  ctx.fillText(bar.name.toUpperCase(), w / 2, 18)
  ctx.shadowBlur = 0

  ctx.fillStyle = 'rgba(5,5,12,.8)'
  ctx.fillRect(16, 26, w - 32, 14)
  const frac = Math.max(0, hp / nameplateMaxHp)
  ctx.fillStyle = frac > 0.5 ? '#39ff14' : frac > 0.25 ? '#fcee0a' : '#ff2a6d'
  ctx.fillRect(18, 28, (w - 36) * frac, 10)
  ctx.strokeStyle = 'rgba(0,240,255,.7)'
  ctx.lineWidth = 2
  ctx.strokeRect(17, 27, w - 34, 12)

  if (dashFrac !== null) {
    ctx.fillStyle = 'rgba(5,5,12,.8)'
    ctx.fillRect(16, 44, w - 32, 8)
    ctx.fillStyle = dashFrac >= 1 ? '#fcee0a' : 'rgba(252,238,10,.55)'
    ctx.fillRect(18, 46, (w - 36) * Math.min(1, dashFrac), 4)
    ctx.strokeStyle = 'rgba(252,238,10,.6)'
    ctx.lineWidth = 1
    ctx.strokeRect(16.5, 44.5, w - 33, 7)
  }
  tex.needsUpdate = true
}

// Floating damage numbers.
export function createPopups(scene) {
  const popups = []

  function spawn(text, color, worldPos) {
    const c = document.createElement('canvas')
    c.width = 128
    c.height = 64
    const ctx = c.getContext('2d')
    ctx.font = 'bold 44px Verdana'
    ctx.textAlign = 'center'
    ctx.fillStyle = color
    ctx.shadowColor = color
    ctx.shadowBlur = 12
    ctx.fillText(text, 64, 48)
    const tex = new THREE.CanvasTexture(c)
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, depthTest: false,
    }))
    sprite.scale.set(0.9, 0.45, 1)
    sprite.position.copy(worldPos)
    tagOverlaySprite(sprite)
    scene.add(sprite)
    popups.push({ sprite, life: 1 })
  }

  function update(dt) {
    for (let i = popups.length - 1; i >= 0; i--) {
      const pop = popups[i]
      pop.life -= dt * 1.1
      pop.sprite.position.y += dt * 1.2
      pop.sprite.material.opacity = Math.max(0, pop.life)
      if (pop.life <= 0) {
        scene.remove(pop.sprite)
        pop.sprite.material.map.dispose()
        pop.sprite.material.dispose()
        popups.splice(i, 1)
      }
    }
  }

  return { spawn, update }
}
