import { SlashCommandBuilder } from 'discord.js';
import { handleException } from '../modules/utils.js';
import https from "https";
import dotenv from 'dotenv';
dotenv.config(); // process.env.CONSTANT

export default {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Description'),

    async execute(interaction) {
        await interaction.deferReply();

        try {
            const fetchTime = (url) => {
                return new Promise((resolve, reject) => {
                    https.get(url, (res) => {
                        let data = '';
                        res.on('data', (chunk) => {
                            data += chunk;
                        });
                        res.on('end', () => {
                            resolve(JSON.parse(data));
                        });
                    }).on('error', (err) => {
                        reject(err);
                    });
                });
            };

            const currentTime = new Date(interaction.createdTimestamp).toLocaleTimeString('fr-FR', { timeZone: 'Europe/London' });

            const [response1, response2] = await Promise.all([
                fetchTime('https://worldtimeapi.org/api/timezone/Europe/Paris'),
                fetchTime('https://timeapi.io/api/Time/current/zone?timeZone=Europe/Paris')
            ]);

            const time1 = new Date(response1.datetime).toLocaleTimeString('fr-FR', { timeZone: 'Europe/London' });
            const time2 = new Date(response2.dateTime).toLocaleTimeString('fr-FR', { timeZone: 'Europe/London' });

            await interaction.editReply(`Heures actuelles :\n- Heure de l'interaction : ${currentTime}\n- worldtimeapi.org : ${time1}\n- timeapi.io : ${time2}`);
        } catch (error) {
            console.error(error);
            await interaction.editReply('Erreur lors de la récupération des heures.');
        }
    },
};