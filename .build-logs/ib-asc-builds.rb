require "spaceship"
Spaceship::ConnectAPI.token = Spaceship::ConnectAPI::Token.create(key_id: ENV["ASC_KEY_ID"], issuer_id: ENV["ASC_ISSUER_ID"], filepath: File.expand_path(ENV["ASC_KEY_PATH"]))
app = Spaceship::ConnectAPI::App.find("com.harrisonfischberg.keepsake")
all = app.get_builds(includes: "preReleaseVersion", limit: 200)
all.group_by { |b| b.pre_release_version&.platform }.each do |p, bs|
  bs.sort_by { |b| -b.version.to_i }.first(4).each { |x| puts "#{p} #{x.app_version} (#{x.version}) #{x.uploaded_date} #{x.processing_state}" }
end
