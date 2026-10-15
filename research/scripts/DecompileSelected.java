import jadx.api.JadxArgs;
import jadx.api.JadxDecompiler;
import jadx.api.JavaClass;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.HashSet;
import java.nio.charset.StandardCharsets;

/** Static source export of explicitly named APK classes; never loads APK classes into the JVM. */
class DecompileSelected {
    public static void main(String[] input) throws Exception {
        var options = new JadxArgs();
        options.setInputFile(new File(input[0]));
        options.setSkipResources(true);
        options.setThreadsCount(4);
        options.setDeobfuscationOn(false);
        var requested = new HashSet<>(Arrays.asList(input).subList(2, input.length));
        Path output = Path.of(input[1]);
        Files.createDirectories(output);
        try (var jadx = new JadxDecompiler(options)) {
            jadx.load();
            for (JavaClass cls : jadx.getClasses()) {
                if (requested.remove(cls.getRawName())) {
                    String code = cls.getCode();
                    Files.writeString(output.resolve(cls.getRawName() + ".java"), code, StandardCharsets.UTF_8);
                    System.out.println("EXPORTED " + cls.getRawName() + " chars=" + code.length());
                }
            }
        }
        if (!requested.isEmpty()) throw new IllegalStateException("Classes not found: " + requested);
    }
}
