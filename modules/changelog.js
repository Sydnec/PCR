import { EmbedBuilder, Colors } from 'discord.js';
import dotenv from 'dotenv';
import { handleException } from './utils.js';
dotenv.config();

/**
 * Publie une annonce de nouvelle fonctionnalité dans le canal changelog
 * @param {import('discord.js').Client} client - Le client Discord
 * @param {Object} featureInfo - Informations sur la nouvelle fonctionnalité
 * @param {string} featureInfo.type - Type de fonctionnalité ('command' ou 'event')
 * @param {string} featureInfo.name - Nom de la fonctionnalité
 * @param {string} featureInfo.description - Description de la fonctionnalité
 * @param {string} featureInfo.author - Auteur de la fonctionnalité (optionnel)
 * @param {string} featureInfo.version - Version (optionnel)
 */
export async function announceNewFeature(client, featureInfo) {
    try {
        const changelogChannelId = process.env.CHANGELOG_CHANNEL_ID;
        
        if (!changelogChannelId) {
            console.warn('⚠️  CHANGELOG_CHANNEL_ID non défini dans .env - annonce ignorée');
            return;
        }

        const channel = await client.channels.fetch(changelogChannelId);
        if (!channel) {
            console.error('❌ Canal changelog non trouvé:', changelogChannelId);
            return;
        }

        const { type, name, description, author, version } = featureInfo;
        
        // Déterminer l'icône et la couleur selon le type
        const typeConfig = {
            command: {
                icon: '⚡',
                color: Colors.Blue,
                title: 'Nouvelle Commande'
            },
            event: {
                icon: '🎯',
                color: Colors.Green,
                title: 'Nouvel Événement'
            },
            feature: {
                icon: '✨',
                color: Colors.Gold,
                title: 'Nouvelle Fonctionnalité'
            }
        };

        const config = typeConfig[type] || typeConfig.feature;
        
        const embed = new EmbedBuilder()
            .setTitle(`${config.icon} ${config.title} Ajoutée !`)
            .setColor(config.color)
            .addFields(
                { 
                    name: '🎯 Fonctionnalité', 
                    value: `\`${name}\``, 
                    inline: true 
                },
                { 
                    name: '📝 Description', 
                    value: description || 'Aucune description fournie', 
                    inline: false 
                }
            )
            .setTimestamp()
            .setFooter({ 
                text: `PCR Bot • ${type === 'command' ? 'Commande' : type === 'event' ? 'Événement' : 'Fonctionnalité'}`,
                iconURL: client.user?.displayAvatarURL()
            });

        // Ajouter des champs optionnels
        if (author) {
            embed.addFields({ name: '👨‍💻 Développeur', value: author, inline: true });
        }
        
        if (version) {
            embed.addFields({ name: '🔢 Version', value: version, inline: true });
        }

        // Ajouter des instructions selon le type
        if (type === 'command') {
            embed.addFields({
                name: '💡 Comment l\'utiliser',
                value: `Utilisez \`/${name}\` dans n'importe quel canal où le bot a accès !`,
                inline: false
            });
        }

        await channel.send({ embeds: [embed] });
        console.log(`✅ Annonce de fonctionnalité publiée dans #${channel.name}: ${type} "${name}"`);
        
    } catch (error) {
        console.error('❌ Erreur lors de l\'annonce de fonctionnalité:', error);
        handleException(error);
    }
}

/**
 * Publie un changelog complet avec plusieurs fonctionnalités
 * @param {import('discord.js').Client} client - Le client Discord
 * @param {Object} changelogInfo - Informations du changelog
 * @param {string} changelogInfo.version - Version du changelog
 * @param {Array} changelogInfo.features - Liste des fonctionnalités
 * @param {string} changelogInfo.title - Titre du changelog (optionnel)
 */
export async function announceChangelog(client, changelogInfo) {
    try {
        const changelogChannelId = process.env.CHANGELOG_CHANNEL_ID;
        
        if (!changelogChannelId) {
            console.warn('⚠️  CHANGELOG_CHANNEL_ID non défini dans .env - changelog ignoré');
            return;
        }

        const channel = await client.channels.fetch(changelogChannelId);
        if (!channel) {
            console.error('❌ Canal changelog non trouvé:', changelogChannelId);
            return;
        }

        const { version, features, title } = changelogInfo;
        
        const embed = new EmbedBuilder()
            .setTitle(`📋 ${title || 'Changelog'} - Version ${version}`)
            .setColor(Colors.Purple)
            .setTimestamp()
            .setFooter({ 
                text: 'PCR Bot • Mise à jour',
                iconURL: client.user?.displayAvatarURL()
            });

        // Grouper les fonctionnalités par type
        const commands = features.filter(f => f.type === 'command');
        const events = features.filter(f => f.type === 'event');
        const otherFeatures = features.filter(f => f.type !== 'command' && f.type !== 'event');

        // Ajouter les commandes
        if (commands.length > 0) {
            const commandList = commands.map(cmd => `• \`/${cmd.name}\` - ${cmd.description}`).join('\n');
            embed.addFields({
                name: '⚡ Nouvelles Commandes',
                value: commandList,
                inline: false
            });
        }

        // Ajouter les événements
        if (events.length > 0) {
            const eventList = events.map(evt => `• \`${evt.name}\` - ${evt.description}`).join('\n');
            embed.addFields({
                name: '🎯 Nouveaux Événements',
                value: eventList,
                inline: false
            });
        }

        // Ajouter les autres fonctionnalités
        if (otherFeatures.length > 0) {
            const featureList = otherFeatures.map(feat => `• \`${feat.name}\` - ${feat.description}`).join('\n');
            embed.addFields({
                name: '✨ Autres Améliorations',
                value: featureList,
                inline: false
            });
        }

        // Ajouter un message de remerciement
        embed.addFields({
            name: '🙏 Merci !',
            value: 'Merci de contribuer à l\'amélioration du serveur ! N\'hésitez pas à tester ces nouvelles fonctionnalités.',
            inline: false
        });

        await channel.send({ embeds: [embed] });
        console.log(`✅ Changelog publié dans #${channel.name} - Version ${version}`);
        
    } catch (error) {
        console.error('❌ Erreur lors de la publication du changelog:', error);
        handleException(error);
    }
}
