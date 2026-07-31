from rest_framework import serializers
from .models import Song, SongReport


class SongSerializer(serializers.ModelSerializer):
    class Meta:
        model = Song
        fields = [
            'id',
            'title',
            'artist',
            'platinum_number',
            'language',
            'genre',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class SongReportSerializer(serializers.ModelSerializer):
    """Public create serializer for wrong-number reports."""

    class Meta:
        model = SongReport
        fields = [
            'id',
            'song',
            'platinum_number',
            'title',
            'artist',
            'suggested_number',
            'note',
            'status',
            'created_at',
        ]
        read_only_fields = ['id', 'status', 'created_at']

    def validate(self, attrs):
        number = (attrs.get('platinum_number') or '').strip()
        if not number:
            raise serializers.ValidationError({'platinum_number': 'Required.'})
        attrs['platinum_number'] = number

        song = attrs.get('song')
        if song is None:
            song = Song.objects.filter(platinum_number=number).first()
            attrs['song'] = song

        if song and not attrs.get('title'):
            attrs['title'] = song.title
        if song and not attrs.get('artist'):
            attrs['artist'] = song.artist

        note = (attrs.get('note') or '').strip()
        if len(note) < 5:
            raise serializers.ValidationError(
                {'note': 'Please add a short explanation (at least 5 characters).'}
            )
        attrs['note'] = note
        return attrs


class SongReportAdminSerializer(serializers.ModelSerializer):
    song_detail = SongSerializer(source='song', read_only=True)

    class Meta:
        model = SongReport
        fields = [
            'id',
            'song',
            'song_detail',
            'platinum_number',
            'title',
            'artist',
            'suggested_number',
            'note',
            'admin_notes',
            'status',
            'created_at',
            'updated_at',
        ]
        read_only_fields = fields


class ResolveReportSerializer(serializers.Serializer):
    action = serializers.ChoiceField(
        choices=[
            'update_number',
            'delete_and_add',
            'add_correct',
            'delete_wrong',
            'reviewed',
            'reject',
        ]
    )
    admin_notes = serializers.CharField(required=False, allow_blank=True, default='')
    correct_number = serializers.CharField(required=False, allow_blank=True, default='')
    title = serializers.CharField(required=False, allow_blank=True, default='')
    artist = serializers.CharField(required=False, allow_blank=True, default='')
    language = serializers.CharField(required=False, allow_blank=True, default='')
    genre = serializers.CharField(required=False, allow_blank=True, default='')
