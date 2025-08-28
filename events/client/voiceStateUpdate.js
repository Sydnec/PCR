// Événement: voiceStateUpdate
//
import { handleException, log } from '../../modules/utils.js';
import dotenv from 'dotenv';
dotenv.config();

const name = 'voiceStateUpdate';
const once = false;
import db from '../../modules/db.js';





async function execute(oldState, newState) {
	try {
		// Si l'utilisateur rejoint un salon vocal
		if (!oldState.channelId && newState.channelId) {
			db.run(
				`INSERT INTO voice_time (user_id, join_time) VALUES (?, ?)
				ON CONFLICT(user_id) DO UPDATE SET join_time = excluded.join_time`,
				[newState.id, Date.now()],
				(err) => {
					if (err) handleException(err, 'voiceStateUpdate');
				}
			);
		}
		// Si l'utilisateur quitte un salon vocal
		else if (oldState.channelId && !newState.channelId) {
			db.get('SELECT join_time, total_time_ms, longest_session FROM voice_time WHERE user_id = ?', [newState.id], (err, row) => {
				if (err) return handleException(err, 'voiceStateUpdate');
				if (row && row.join_time) {
					const durationMs = Date.now() - row.join_time;
					const newTotal = (row.total_time_ms || 0) + durationMs;
					const newLongest = Math.max(durationMs, row.longest_session || 0);
					db.run(
						'UPDATE voice_time SET total_time_ms = ?, longest_session = ?, join_time = NULL WHERE user_id = ?',
						[newTotal, newLongest, newState.id],
						(err) => {
							if (err) handleException(err, 'voiceStateUpdate');
						}
					);
				}
			});
		}
	} catch (error) {
		handleException(error, 'voiceStateUpdate');
	}
}

export { name, once, execute };
