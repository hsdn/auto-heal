"use strict";

module.exports = function AutoHeal(mod) {
	let hooks = [];
	let debug = false;
	let playerLocation = null;
	let job = null;
	let glyphs = null;
	let partyMembers = [];

	mod.command.add("autoheal", {
		"debug": () => {
			debug = !debug;
			mod.command.message(`Debug ${ debug ? "enabled" : "disabled"}`);
		},
		"cleanse": () => {
			mod.settings.autoCleanse = !mod.settings.autoCleanse;
			mod.command.message(`Cleansing ${mod.settings.autoCleanse ? "enabled" : "disabled"}`);
		},
		"cast": () => {
			mod.settings.autoCast = !mod.settings.autoCast;
			mod.command.message(`Casting ${mod.settings.autoCast ? "enabled" : "disabled"}`);
		},
		"$none": () => {
			mod.settings.autoHeal = !mod.settings.autoHeal;
			mod.command.message(`Healing ${mod.settings.autoHeal ? `enabled (${mod.settings.hpCutoff}%)` : "disabled"}`);
		}
	});

	mod.game.on("enter_game", () => {
		job = (mod.game.me.templateId - 10101) % 100;
		(mod.settings.skills[job]) ? load() : unload();
	});

	function hook() {
		hooks.push(mod.hook(...arguments));
	}

	function unload() {
		hooks.forEach(h => mod.unhook(h));
		hooks = [];
	}

	function load() {
		if (!hooks.length) {
			hook("S_PARTY_MEMBER_LIST", 9, event => {
				const copyMembers = partyMembers;
				partyMembers = event.members.filter(m => m.playerId !== mod.game.me.playerId);

				if (copyMembers) {
					partyMembers.forEach(partyMember => {
						if (partyMember.debuffs === undefined) partyMember.debuffs = [];

						const copyMember = copyMembers.find(m => m.playerId === partyMember.playerId);

						if (copyMember) {
							partyMember.gameId = copyMember.gameId;

							if (copyMember.loc) {
								partyMember.loc = copyMember.loc;
							}
						}
					});
				}
			});

			hook("S_LEAVE_PARTY", 1, () => {
				partyMembers = [];
			});

			hook("C_PLAYER_LOCATION", 5, event => {
				playerLocation = event;
			});

			hook("S_SPAWN_ME", 3, event => {
				playerLocation = event;
			});

			hook("S_SPAWN_USER", 17, event => {
				if (partyMembers.length != 0) {
					const member = partyMembers.find(m => m.playerId === event.playerId);

					if (member) {
						member.gameId = event.gameId;
						member.loc = event.loc;
						member.alive = event.alive;
						member.hpP = event.alive ? 100 : 0;
					}
				}
			});

			hook("S_USER_LOCATION", 6, event => {
				const member = partyMembers.find(m => m.gameId === event.gameId);

				if (member) {
					member.loc = event.loc;
				}
			});

			hook("S_USER_LOCATION_IN_ACTION", 2, event => {
				const member = partyMembers.find(m => m.gameId === event.gameId);

				if (member) {
					member.loc = event.loc;
				}
			});

			hook("S_INSTANT_DASH", 3, event => {
				const member = partyMembers.find(m => m.gameId === event.gameId);

				if (member) {
					member.loc = event.loc;
				}
			});

			hook("S_PARTY_MEMBER_CHANGE_HP", 4, event => {
				if (mod.game.me.playerId == event.playerId) return;

				const member = partyMembers.find(m => m.playerId === event.playerId);

				if (member) {
					member.hpP = (Number(event.currentHp) / Number(event.maxHp)) * 100;
				}
			});

			hook("S_PARTY_MEMBER_STAT_UPDATE", mod.majorPatchVersion >= 108 ? 4 : 3, event => {
				if (mod.game.me.playerId == event.playerId) return;

				const member = partyMembers.find(m => m.playerId === event.playerId);

				if (member) {
					member.hpP = (Number(event.hp || event.curHp) / Number(event.maxHp)) * 100;
					member.alive = event.alive;
				}
			});

			hook("S_DEAD_LOCATION", 2, event => {
				const member = partyMembers.find(m => (m.gameId === event.gameId));

				if (member) {
					member.loc = event.loc;
					member.hpP = 0;
					member.alive = false;
				}
			});

			hook("S_LEAVE_PARTY_MEMBER", 2, event => {
				partyMembers = partyMembers.filter(m => m.playerId !== event.playerId);
			});

			hook("S_LOGOUT_PARTY_MEMBER", 1, event => {
				const member = partyMembers.find(m => m.playerId === event.playerId);

				if (member) {
					member.online = false;
				}
			});

			hook("S_BAN_PARTY_MEMBER", 1, event => {
				partyMembers = partyMembers.filter(m => m.playerId != event.playerId);
			});

			hook("C_START_SKILL", 7, event => {
				if (partyMembers.length === 0) return;

				if (event.skill.id / 10 & 1 !== 0) {
					playerLocation.w = event.w;
				}

				const skill = Math.floor(event.skill.id / 10000);

				if (mod.settings.skills[job] && mod.settings.skills[job].includes(skill)) {
					if (skill !== 9 && !mod.settings.autoHeal) return;
					if (skill === 9 && !mod.settings.autoCleanse) return;
					if (skill === 9 && partyMembers.length > 4) return;

					const targetMembers = [];
					const maxTargetCount = getMaxTargets(skill);

					if (skill != 9) sortHp();
					partyMembers.forEach(partyMember => {
						if (partyMember.online && partyMember.alive &&
							partyMember.hpP !== undefined &&
							partyMember.hpP !== 0 &&
							(skill === 9 ? true : partyMember.hpP <= mod.settings.hpCutoff) &&
							partyMember.loc != undefined &&
							(partyMember.loc.dist3D(playerLocation.loc) / 25) <= mod.settings.maxDistance) {
							targetMembers.push(partyMember);
							if (targetMembers.length === maxTargetCount) return;
						}
					});

					if (targetMembers.length > 0) {
						if (debug) {
							outputDebug(event.skill);
						}

						const lockSpeed = Array.isArray(mod.settings.lockSpeed) ?
							Math.random() * (mod.settings.lockSpeed[1] - mod.settings.lockSpeed[0]) + mod.settings.lockSpeed[0] : mod.settings.lockSpeed;

						const castSpeed = Array.isArray(mod.settings.castSpeed) ?
							Math.random() * (mod.settings.castSpeed[1] - mod.settings.castSpeed[0]) + mod.settings.castSpeed[0] : mod.settings.castSpeed;

						targetMembers.forEach(targetMember =>
							setTimeout(() => mod.send("C_CAN_LOCKON_TARGET", 3, { target: targetMember.gameId, skill: event.skill.id }), lockSpeed)
						);

						if (mod.settings.autoCast) {
							setTimeout(() => mod.send("C_START_SKILL", 7, { ...event, w: playerLocation.w, skill: (event.skill.id + 10) }), castSpeed);
						}
					}
				}
			});

			hook("S_CREST_INFO", 2, event => {
				glyphs = event.crests;
			});

			hook("S_CREST_APPLY", 2, event => {
				const glyph = glyphs.find(g => g.id === event.id);

				if (glyph) {
					glyph.enable = event.enable;
				}
			});
		}
	}

	function getMaxTargets(skill) {
		switch (skill) {
			case 19:
				return isGlyphEnabled(28003) ? 4 : 2;
			case 37:
				return 1;
			case 5:
				return isGlyphEnabled(27000) ? 4 : 2;
			case 9:
				return (isGlyphEnabled(27063) || isGlyphEnabled(27003)) ? 5 : 3;
		}

		return 1;
	}

	function isGlyphEnabled(glyphId) {
		return !!glyphs.find(g => g.id === glyphId && g.enable);
	}

	function sortHp() {
		partyMembers.sort((a, b) => parseFloat(a.hpP) - parseFloat(b.hpP));
	}

	function outputDebug(skill) {
		let out = `\nAutoheal Debug... Skill: ${skill.id}\tpartyMemebers.length: ${partyMembers.length}`;

		partyMembers.forEach((partyMember, i) => {
			out += `\n${++i}\t`;
			out += partyMember.name + " ".repeat(21 - partyMember.name.length);
			out += `\tHP: ${parseFloat(partyMember.hpP).toFixed(2)}`;
			out += partyMember.loc ? `\tDist: ${(partyMember.loc.dist3D(playerLocation.loc) / 25).toFixed(2)}` : "\tundefined";
			// out += `\tVert: ${(Math.abs(partyMember.loc.z - playerLocation.loc.z) / 25).toFixed(2)}`;
			out += `\tOnline: ${partyMember.online}`;
			out += `\tAlive: ${partyMember.alive}`;
			// out += `\tDebuffs: ${partyMember.debuffs}`;
			out += `\tpid: ${partyMember.playerId}  gid: ${partyMember.gameId}`;
		});

		console.log(out);
	}
};