import jadx.api.JadxArgs;
import jadx.api.JadxDecompiler;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;

class ExportResources {
    public static void main(String[] args) throws Exception {
        var options = new JadxArgs();
        options.setInputFile(new File(args[0]));
        options.setThreadsCount(2);
        options.setSkipSources(true);
        try (var jadx = new JadxDecompiler(options)) {
            jadx.load();
            for (var resource : jadx.getResources()) {
                String name = resource.getOriginalName();
                if (name.contains("item_customized_gain_sb.xml") || name.contains("item_customized_gain_sb_s3000.xml") || name.contains("item_diy_gain_sb_new_skin.xml")) {
                    var content = resource.loadContent();
                    Files.writeString(Path.of(args[1], Path.of(name).getFileName().toString()), content.getText().getCodeStr(), StandardCharsets.UTF_8);
                    System.out.println("EXPORTED " + name);
                }
            }
        }
    }
}
