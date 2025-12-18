import { openWorldbookCommonPanel } from '../ui/worldbook-common-panel.js';

let registered = false;
let isEnabled = () => true;

async function getSlashCommandModules() {
    const [parserMod, commandMod] = await Promise.all([
        import('/scripts/slash-commands/SlashCommandParser.js'),
        import('/scripts/slash-commands/SlashCommand.js'),
    ]);
    return { SlashCommandParser: parserMod.SlashCommandParser, SlashCommand: commandMod.SlashCommand };
}

export async function ensureWorldbookCommonSlashCommand({ enabled }) {
    if (typeof enabled === 'function') isEnabled = enabled;
    if (registered) return true;

    try {
        const { SlashCommandParser, SlashCommand } = await getSlashCommandModules();
        if (!SlashCommandParser?.addCommandObject || !SlashCommand?.fromProps) return false;

        SlashCommandParser.addCommandObject(
            SlashCommand.fromProps({
                name: 'pt-wb-common',
                helpString: '打开世界书常用面板',
                aliases: ['worldbook-common'],
                callback: async () => {
                    if (!isEnabled()) {
                        if (window.toastr) toastr.info('世界书常用功能已关闭');
                        return '';
                    }
                    await openWorldbookCommonPanel();
                    return '';
                },
            }),
        );

        registered = true;
        return true;
    } catch (e) {
        console.warn('PresetTransfer: failed to register slash command', e);
        return false;
    }
}

