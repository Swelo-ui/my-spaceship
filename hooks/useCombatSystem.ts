/**
 * Combat System Hook
 * Manages enemy AI, projectile physics, collision detection, health/shields
 */

import { useRef, useState, useCallback, useEffect, MutableRefObject } from 'react';
import { CombatState, Enemy, Projectile, EnemyState, CameraData } from '../types';
import { v4 as uuidv4 } from 'uuid';

// ── Constants ──────────────────────────────────────────────────────────────
const PLAYER_MAX_HEALTH = 100;
const PLAYER_MAX_SHIELDS = 100;
const PLAYER_SHIELD_RECHARGE_DELAY = 5.0;
const PLAYER_SHIELD_RECHARGE_RATE = 15.0;
const PLAYER_MAX_AMMO = 30;
const PLAYER_FIRE_RATE = 0.18;          // seconds between shots (hold to fire)

const ENEMY_DETECTION_RANGE = 8.0;
const ENEMY_ATTACK_RANGE = 5.0;
const ENEMY_FIRE_RANGE = 6.0;
const ENEMY_SPEED = 0.4;
const ENEMY_TURN_SPEED = 1.5;

const PROJECTILE_SPEED = 5.0;
const PROJECTILE_LIFETIME = 3.0;
const PROJECTILE_HIT_RADIUS_ENEMY = 0.6;   // generous hit box for enemies
const PROJECTILE_HIT_RADIUS_PLAYER = 0.8;  // generous hit box for player

const WAVE_SPAWN_INTERVAL = 20.0;
const ENEMIES_PER_WAVE_BASE = 3;

// ── Helpers ────────────────────────────────────────────────────────────────
const vec3Sub = (a: [number, number, number], b: [number, number, number]): [number, number, number] =>
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const vec3Len = (v: [number, number, number]): number =>
    Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);

const vec3Norm = (v: [number, number, number]): [number, number, number] => {
    const l = vec3Len(v) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const spawnEnemy = (playerPos: [number, number, number], variant: number): Enemy => {
    const angle = Math.random() * Math.PI * 2;
    const dist = 5 + Math.random() * 4;
    const heightOffset = (Math.random() - 0.5) * 2;
    return {
        id: uuidv4(),
        position: [
            playerPos[0] + Math.cos(angle) * dist,
            playerPos[1] + heightOffset,
            playerPos[2] + Math.sin(angle) * dist,
        ],
        velocity: [0, 0, 0],
        rotation: [0, angle + Math.PI],
        roll: 0,
        health: 40 + variant * 20,
        maxHealth: 40 + variant * 20,
        shields: variant > 0 ? 30 : 0,
        maxShields: variant > 0 ? 30 : 0,
        shieldRechargeTimer: 0,
        state: 'patrol',
        stateTimer: 0,
        fireTimer: 1.0 + Math.random() * 2.0,
        fireCooldown: 1.5 + variant * 0.5,
        hitFlashTimer: 0,
        deathTimer: 0,
        shapeVariant: variant,
    };
};

const spawnWave = (playerPos: [number, number, number], wave: number): Enemy[] => {
    const count = ENEMIES_PER_WAVE_BASE + Math.floor(wave / 2);
    return Array.from({ length: count }, (_, i) => spawnEnemy(playerPos, i % 3));
};

// ── Hook ───────────────────────────────────────────────────────────────────
export interface CombatSystemAPI {
    combatStateRef: MutableRefObject<CombatState>;
    combatState: CombatState;
    firePlayerLaser: () => void;
    resetCombat: () => void;
}

export const useCombatSystem = (
    cameraRef: MutableRefObject<CameraData>,
    cameraVelocityRef: MutableRefObject<[number, number, number]>,
    pressedKeysRef: MutableRefObject<Set<string>>,
): CombatSystemAPI => {

    const makeInitialState = (): CombatState => ({
        enemies: [],
        projectiles: [],
        playerHealth: PLAYER_MAX_HEALTH,
        playerMaxHealth: PLAYER_MAX_HEALTH,
        playerShields: PLAYER_MAX_SHIELDS,
        playerMaxShields: PLAYER_MAX_SHIELDS,
        playerShieldRechargeTimer: 0,
        score: 0,
        wave: 0,
        waveTimer: 3.0,
        isGameOver: false,
        ammo: PLAYER_MAX_AMMO,
        maxAmmo: PLAYER_MAX_AMMO,
        ammoRechargeTimer: 0,
        lastHitTime: -100,
        killCount: 0,
    });

    const combatStateRef = useRef<CombatState>(makeInitialState());
    const [combatState, setCombatState] = useState<CombatState>(makeInitialState());
    const lastSyncRef = useRef(0);
    // Separate fire cooldown ref so it doesn't depend on state
    const fireCooldownRef = useRef(0);

    const resetCombat = useCallback(() => {
        const fresh = makeInitialState();
        combatStateRef.current = fresh;
        fireCooldownRef.current = 0;
        setCombatState(fresh);
    }, []);

    // External fire trigger (for button press)
    const firePlayerLaser = useCallback(() => {
        const cs = combatStateRef.current;
        if (cs.isGameOver || cs.ammo <= 0 || fireCooldownRef.current > 0) return;

        const cam = cameraRef.current;
        const pitch = cam.rotation[0];
        const yaw = cam.rotation[1];

        const dirX = Math.sin(yaw) * Math.cos(pitch);
        const dirY = -Math.sin(pitch);
        const dirZ = Math.cos(yaw) * Math.cos(pitch);

        const proj: Projectile = {
            id: uuidv4(),
            position: [cam.position[0], cam.position[1], cam.position[2]],
            velocity: [
                dirX * PROJECTILE_SPEED,
                dirY * PROJECTILE_SPEED,
                dirZ * PROJECTILE_SPEED,
            ],
            lifetime: PROJECTILE_LIFETIME,
            isPlayerShot: true,
            damage: 25,
        };

        combatStateRef.current = {
            ...cs,
            projectiles: [...cs.projectiles, proj],
            ammo: cs.ammo - 1,
        };
        fireCooldownRef.current = PLAYER_FIRE_RATE;
    }, [cameraRef]);

    // ── Main combat loop ────────────────────────────────────────────────────
    useEffect(() => {
        let frameId: number;
        let lastTime = 0;

        const loop = (timestamp: number) => {
            if (lastTime === 0) lastTime = timestamp;
            const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
            lastTime = timestamp;

            // Tick fire cooldown
            if (fireCooldownRef.current > 0) {
                fireCooldownRef.current = Math.max(0, fireCooldownRef.current - dt);
            }

            const cs = combatStateRef.current;
            if (cs.isGameOver) {
                frameId = requestAnimationFrame(loop);
                return;
            }

            const playerPos = cameraRef.current.position as [number, number, number];
            const now = timestamp / 1000;

            // ── F key: hold to fire ───────────────────────────────────────
            if (pressedKeysRef.current.has('f') && cs.ammo > 0 && fireCooldownRef.current <= 0) {
                const cam = cameraRef.current;
                const pitch = cam.rotation[0];
                const yaw = cam.rotation[1];
                const dirX = Math.sin(yaw) * Math.cos(pitch);
                const dirY = -Math.sin(pitch);
                const dirZ = Math.cos(yaw) * Math.cos(pitch);

                const newProj: Projectile = {
                    id: uuidv4(),
                    position: [cam.position[0], cam.position[1], cam.position[2]],
                    velocity: [dirX * PROJECTILE_SPEED, dirY * PROJECTILE_SPEED, dirZ * PROJECTILE_SPEED],
                    lifetime: PROJECTILE_LIFETIME,
                    isPlayerShot: true,
                    damage: 25,
                };
                cs.projectiles = [...cs.projectiles, newProj];
                cs.ammo = Math.max(0, cs.ammo - 1);
                fireCooldownRef.current = PLAYER_FIRE_RATE;
            }

            // ── Wave spawning ─────────────────────────────────────────────
            let { enemies, projectiles, wave, waveTimer } = cs;
            waveTimer -= dt;
            const aliveEnemies = enemies.filter(e => e.state !== 'dead');
            if (waveTimer <= 0 && aliveEnemies.length === 0) {
                wave += 1;
                enemies = [...enemies.filter(e => e.state === 'dead'), ...spawnWave(playerPos, wave)];
                waveTimer = WAVE_SPAWN_INTERVAL;
            }

            // ── Update enemies ────────────────────────────────────────────
            const newEnemyProjectiles: Projectile[] = [];

            enemies = enemies.map(enemy => {
                if (enemy.state === 'dead') return enemy;

                let { position, velocity, rotation, roll, state, stateTimer, fireTimer,
                    health, shields, shieldRechargeTimer, hitFlashTimer, deathTimer } = enemy;

                hitFlashTimer = Math.max(0, hitFlashTimer - dt);

                // Shield recharge
                if (shieldRechargeTimer > 0) {
                    shieldRechargeTimer -= dt;
                } else if (shields < enemy.maxShields) {
                    shields = Math.min(enemy.maxShields, shields + 10 * dt);
                }

                // Death animation
                if (state === 'dying') {
                    deathTimer += dt;
                    if (deathTimer > 1.5) {
                        return { ...enemy, state: 'dead' as EnemyState };
                    }
                    return { ...enemy, deathTimer, hitFlashTimer };
                }

                // ── AI State Machine ──────────────────────────────────────
                const toPlayer = vec3Sub(playerPos, position);
                const distToPlayer = vec3Len(toPlayer);
                const dirToPlayer = vec3Norm(toPlayer);
                stateTimer += dt;

                if (distToPlayer < ENEMY_DETECTION_RANGE && state === 'patrol') {
                    state = 'chase'; stateTimer = 0;
                } else if (distToPlayer < ENEMY_ATTACK_RANGE && state === 'chase') {
                    state = 'attack'; stateTimer = 0;
                } else if (distToPlayer > ENEMY_DETECTION_RANGE * 1.5 && state !== 'patrol') {
                    state = 'patrol'; stateTimer = 0;
                }
                if (health < enemy.maxHealth * 0.3 && state !== 'evade' && Math.random() < 0.005) {
                    state = 'evade'; stateTimer = 0;
                }
                if (state === 'evade' && stateTimer > 3.0) {
                    state = 'chase'; stateTimer = 0;
                }

                // ── Movement ──────────────────────────────────────────────
                let targetVelX = 0, targetVelY = 0, targetVelZ = 0;

                if (state === 'patrol') {
                    const patrolAngle = now * 0.3 + parseInt(enemy.id.slice(0, 4), 16) * 0.001;
                    targetVelX = Math.cos(patrolAngle) * ENEMY_SPEED * 0.3;
                    targetVelZ = Math.sin(patrolAngle) * ENEMY_SPEED * 0.3;
                } else if (state === 'chase' || state === 'attack') {
                    const idealDist = state === 'attack' ? ENEMY_ATTACK_RANGE * 0.7 : ENEMY_DETECTION_RANGE * 0.5;
                    const approachFactor = (distToPlayer - idealDist) / idealDist;
                    const speed = ENEMY_SPEED * Math.max(-0.5, Math.min(1.0, approachFactor));
                    targetVelX = dirToPlayer[0] * speed;
                    targetVelY = dirToPlayer[1] * speed * 0.5;
                    targetVelZ = dirToPlayer[2] * speed;
                } else if (state === 'evade') {
                    targetVelX = -dirToPlayer[0] * ENEMY_SPEED * 1.5;
                    targetVelY = (Math.random() - 0.5) * ENEMY_SPEED;
                    targetVelZ = -dirToPlayer[2] * ENEMY_SPEED * 1.5;
                }

                const velLerp = 1.0 - Math.pow(0.01, dt);
                velocity = [
                    lerp(velocity[0], targetVelX, velLerp),
                    lerp(velocity[1], targetVelY, velLerp),
                    lerp(velocity[2], targetVelZ, velLerp),
                ];

                position = [
                    position[0] + velocity[0] * dt,
                    position[1] + velocity[1] * dt,
                    position[2] + velocity[2] * dt,
                ];

                // ── Rotation toward player ────────────────────────────────
                if (state !== 'patrol') {
                    const targetYaw = Math.atan2(toPlayer[0], toPlayer[2]);
                    const targetPitch = -Math.atan2(toPlayer[1], Math.sqrt(toPlayer[0] * toPlayer[0] + toPlayer[2] * toPlayer[2]));
                    const rotLerp = ENEMY_TURN_SPEED * dt;
                    let yawDiff = targetYaw - rotation[1];
                    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
                    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
                    rotation = [
                        lerp(rotation[0], targetPitch, rotLerp),
                        rotation[1] + yawDiff * rotLerp,
                    ];
                    roll = lerp(roll, yawDiff * 0.8, rotLerp);
                }

                // ── Firing ────────────────────────────────────────────────
                fireTimer -= dt;
                if (fireTimer <= 0 && state === 'attack' && distToPlayer < ENEMY_FIRE_RANGE) {
                    fireTimer = enemy.fireCooldown;
                    const inaccuracy = 0.08 + (1 - health / enemy.maxHealth) * 0.1;
                    const shotDir: [number, number, number] = [
                        dirToPlayer[0] + (Math.random() - 0.5) * inaccuracy,
                        dirToPlayer[1] + (Math.random() - 0.5) * inaccuracy,
                        dirToPlayer[2] + (Math.random() - 0.5) * inaccuracy,
                    ];
                    const normDir = vec3Norm(shotDir);
                    newEnemyProjectiles.push({
                        id: uuidv4(),
                        position: [position[0], position[1], position[2]],
                        velocity: [
                            normDir[0] * PROJECTILE_SPEED * 0.75,
                            normDir[1] * PROJECTILE_SPEED * 0.75,
                            normDir[2] * PROJECTILE_SPEED * 0.75,
                        ],
                        lifetime: PROJECTILE_LIFETIME,
                        isPlayerShot: false,
                        damage: 15,
                    });
                }

                return {
                    ...enemy,
                    position, velocity, rotation, roll,
                    state, stateTimer, fireTimer,
                    health, shields, shieldRechargeTimer,
                    hitFlashTimer, deathTimer,
                };
            });

            // ── Update projectiles ────────────────────────────────────────
            let { playerHealth, playerShields, playerShieldRechargeTimer,
                score, ammo, ammoRechargeTimer, lastHitTime, killCount } = cs;

            // Ammo recharge (1 ammo per 0.5s when not firing)
            if (ammoRechargeTimer > 0) {
                ammoRechargeTimer -= dt;
            } else if (ammo < PLAYER_MAX_AMMO) {
                ammo = Math.min(PLAYER_MAX_AMMO, ammo + 1);
                ammoRechargeTimer = 0.5;
            }

            // Player shield recharge
            if (playerShieldRechargeTimer > 0) {
                playerShieldRechargeTimer -= dt;
            } else if (playerShields < PLAYER_MAX_SHIELDS) {
                playerShields = Math.min(PLAYER_MAX_SHIELDS, playerShields + PLAYER_SHIELD_RECHARGE_RATE * dt);
            }

            // Combine all projectiles (player + new enemy shots)
            const allProjectiles = [...projectiles, ...newEnemyProjectiles];
            const survivingProjectiles: Projectile[] = [];

            for (const proj of allProjectiles) {
                const newPos: [number, number, number] = [
                    proj.position[0] + proj.velocity[0] * dt,
                    proj.position[1] + proj.velocity[1] * dt,
                    proj.position[2] + proj.velocity[2] * dt,
                ];
                const newLifetime = proj.lifetime - dt;
                if (newLifetime <= 0) continue;

                let hit = false;

                if (proj.isPlayerShot) {
                    // Check against enemies
                    for (let i = 0; i < enemies.length; i++) {
                        const e = enemies[i];
                        if (e.state === 'dead' || e.state === 'dying') continue;
                        const dist = vec3Len(vec3Sub(newPos, e.position));
                        if (dist < PROJECTILE_HIT_RADIUS_ENEMY) {
                            hit = true;
                            let dmg = proj.damage;
                            let newShields = e.shields;
                            let newHealth = e.health;
                            if (newShields > 0) {
                                const shieldDmg = Math.min(newShields, dmg);
                                newShields -= shieldDmg;
                                dmg -= shieldDmg;
                            }
                            newHealth -= dmg;
                            const newState: EnemyState = newHealth <= 0 ? 'dying' : e.state;
                            if (newHealth <= 0) {
                                score += 100 * (e.shapeVariant + 1);
                                killCount += 1;
                            }
                            enemies[i] = {
                                ...e,
                                health: Math.max(0, newHealth),
                                shields: newShields,
                                shieldRechargeTimer: PLAYER_SHIELD_RECHARGE_DELAY,
                                hitFlashTimer: 0.25,
                                state: newState,
                                deathTimer: newState === 'dying' ? 0 : e.deathTimer,
                            };
                            break;
                        }
                    }
                } else {
                    // Check against player
                    const distToPlayer = vec3Len(vec3Sub(newPos, playerPos));
                    if (distToPlayer < PROJECTILE_HIT_RADIUS_PLAYER) {
                        hit = true;
                        let dmg = proj.damage;
                        if (playerShields > 0) {
                            const shieldDmg = Math.min(playerShields, dmg);
                            playerShields -= shieldDmg;
                            dmg -= shieldDmg;
                        }
                        playerHealth = Math.max(0, playerHealth - dmg);
                        playerShieldRechargeTimer = PLAYER_SHIELD_RECHARGE_DELAY;
                        lastHitTime = now;
                    }
                }

                if (!hit) {
                    survivingProjectiles.push({ ...proj, position: newPos, lifetime: newLifetime });
                }
            }

            const isGameOver = playerHealth <= 0;

            combatStateRef.current = {
                enemies,
                projectiles: survivingProjectiles,
                playerHealth,
                playerMaxHealth: PLAYER_MAX_HEALTH,
                playerShields,
                playerMaxShields: PLAYER_MAX_SHIELDS,
                playerShieldRechargeTimer,
                score,
                wave,
                waveTimer,
                isGameOver,
                ammo,
                maxAmmo: PLAYER_MAX_AMMO,
                ammoRechargeTimer,
                lastHitTime,
                killCount,
            };

            // Sync React state ~20fps
            if (timestamp - lastSyncRef.current > 50) {
                lastSyncRef.current = timestamp;
                setCombatState({ ...combatStateRef.current });
            }

            frameId = requestAnimationFrame(loop);
        };

        frameId = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(frameId);
    }, [cameraRef, cameraVelocityRef, pressedKeysRef, firePlayerLaser]);

    return { combatStateRef, combatState, firePlayerLaser, resetCombat };
};
